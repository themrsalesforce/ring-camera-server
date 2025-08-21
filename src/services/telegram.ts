import TelegramBot from 'node-telegram-bot-api';
import { getSnapshotBase64, getCameraNames, getStoredImages } from './ring.js';
import { 
  getConfig, 
  updateConfig, 
  isUserAuthorized, 
  addAuthorizedUser, 
  removeAuthorizedUser, 
  addPendingUser, 
  removePendingUser, 
  getPendingUsers, 
  getAuthorizedUsers,
  addRequestHistory,
  getRequestHistory,
  getRequestHistoryByUser,
  clearRequestHistory
} from './config.js';
import { analyzeImage, analyzeImageWithThinking } from './vision.js';

interface MenuState {
  chatId: number;
  currentMenu: string;
  selectedCamera?: string;
  lastMessageId?: number;
  user?: TelegramBot.User;
  reminderInterval?: number;
}

const ADMIN_USER_ID = 426747873; // @shmuelchaikin's user ID

interface Reminder {
  id: string;
  chatId: number;
  interval: number; // in minutes
  cameraName?: string;
  lastRun: number;
  isActive: boolean;
  aiPrompt?: string; // For smart reminders with AI analysis
  isSmartReminder?: boolean; // Flag to distinguish smart reminders
}

class TelegramService {
  private bot: TelegramBot;
  private reminders: Map<string, Reminder> = new Map();
  private reminderIntervals: Map<string, NodeJS.Timeout> = new Map();
  private menuStates: Map<number, MenuState> = new Map();

  constructor() {
    const token = process.env.TELEGRAM_BOT_TOKEN || '8142593255:AAEnWaxrjG2jvPyeiQqKwrAy-40l5o2VK80';
    this.bot = new TelegramBot(token, { polling: true });
    this.setupBot();
    this.loadReminders();
  }

  private trackRequest(userId: number, user: TelegramBot.User, action: string, details: string, camera?: string, success: boolean = true, errorMessage?: string) {
    try {
      addRequestHistory({
        userId,
        username: user.username,
        firstName: user.first_name,
        lastName: user.last_name,
        action,
        details,
        camera,
        success,
        errorMessage
      });
    } catch (error) {
      console.error('Failed to track request:', error);
    }
  }

  private setupBot() {
    // Handle /start command
    this.bot.onText(/\/start/, async (msg) => {
      const chatId = msg.chat.id;
      const userId = msg.from?.id;
      
      if (!userId) {
        await this.bot.sendMessage(chatId, 'Error: Could not identify user.');
        return;
      }

      // Check if user is authorized
      if (!isUserAuthorized(userId)) {
        await this.handleUnauthorizedUser(msg);
        return;
      }

      await this.showMainMenu(chatId, userId);
    });

    // Handle /admin command
    this.bot.onText(/\/admin/, async (msg) => {
      await this.handleAdminCommand(msg);
    });

    // Handle /help command
    this.bot.onText(/\/help/, async (msg) => {
      const chatId = msg.chat.id;
      const userId = msg.from?.id;
      
      if (!userId || !isUserAuthorized(userId)) {
        await this.handleUnauthorizedUser(msg);
        return;
      }
      
      await this.bot.sendMessage(chatId, 
        'Ring Camera Bot Help 📸\n\n' +
        'Commands:\n' +
        '• /cameras - List all available Ring cameras\n' +
        '• /snapshot [camera] - Get a snapshot (defaults to first camera)\n' +
        '• /ask [camera] [question] - Ask AI about camera image\n' +
        '  Example: /ask Front Door "Where are the garbage bins?"\n' +
        '• /remind [minutes] [camera] - Set up automated reminders\n' +
        '  Example: /remind 30 Front Door\n' +
        '• /reminders - Show all active reminders\n' +
        '• /stop [id] - Stop a specific reminder\n' +
        '• /help - Show this help message'
      );
    });

    // Handle /cameras command
    this.bot.onText(/\/cameras/, async (msg) => {
      const chatId = msg.chat.id;
      const userId = msg.from?.id;
      
      if (!userId || !isUserAuthorized(userId)) {
        await this.handleUnauthorizedUser(msg);
        return;
      }
      
      try {
        const cameras = await getCameraNames();
        const cameraList = cameras.map((name, index) => `${index + 1}. ${name}`).join('\n');
        await this.bot.sendMessage(chatId, 
          `Available cameras:\n${cameraList}`
        );
      } catch (error) {
        await this.bot.sendMessage(chatId, `Error getting cameras: ${(error as Error).message}`);
      }
    });

    // Handle /snapshot command
    this.bot.onText(/\/snapshot(.*)/, async (msg, match) => {
      const chatId = msg.chat.id;
      const userId = msg.from?.id;
      const cameraName = match?.[1]?.trim();
      
      if (!userId || !isUserAuthorized(userId)) {
        await this.handleUnauthorizedUser(msg);
        return;
      }
      
      try {
        await this.bot.sendMessage(chatId, '📸 Taking snapshot...');
        const imageBase64 = await getSnapshotBase64(cameraName || '');
        const imageBuffer = Buffer.from(imageBase64, 'base64');
        
        const caption = cameraName 
          ? `Snapshot from ${cameraName}`
          : 'Snapshot from camera';
        
        await this.bot.sendPhoto(chatId, imageBuffer, { caption });
      } catch (error) {
        await this.bot.sendMessage(chatId, `Error taking snapshot: ${(error as Error).message}`);
      }
    });

    // Handle /ask command (legacy - redirects to menu)
    this.bot.onText(/\/ask/, async (msg) => {
      const chatId = msg.chat.id;
      const userId = msg.from?.id;
      
      if (!userId || !isUserAuthorized(userId)) {
        await this.handleUnauthorizedUser(msg);
        return;
      }
      
      await this.showCameraMenu(chatId, 'ask');
    });

    // Handle /remind command
    this.bot.onText(/\/remind (\d+)(.*)/, async (msg, match) => {
      const chatId = msg.chat.id;
      const userId = msg.from?.id;
      const intervalMinutes = parseInt(match?.[1] || '0', 10);
      const cameraName = match?.[2]?.trim();
      
      if (!userId || !isUserAuthorized(userId)) {
        await this.handleUnauthorizedUser(msg);
        return;
      }
      
      if (intervalMinutes < 1) {
        await this.bot.sendMessage(chatId, 'Please specify an interval of at least 1 minute.');
        return;
      }

      const reminderId = `${chatId}_${Date.now()}`;
      const reminder: Reminder = {
        id: reminderId,
        chatId,
        interval: intervalMinutes,
        cameraName,
        lastRun: 0,
        isActive: true
      };

      this.reminders.set(reminderId, reminder);
      this.startReminder(reminder);
      this.saveReminders();

      const cameraText = cameraName ? ` from ${cameraName}` : '';
      await this.bot.sendMessage(chatId, 
        `✅ Reminder set! Will send snapshots every ${intervalMinutes} minutes${cameraText}.\nReminder ID: ${reminderId}`
      );
    });

    // Handle /reminders command
    this.bot.onText(/\/reminders/, async (msg) => {
      const chatId = msg.chat.id;
      const userId = msg.from?.id;
      
      if (!userId || !isUserAuthorized(userId)) {
        await this.handleUnauthorizedUser(msg);
        return;
      }
      
      const userReminders = Array.from(this.reminders.values())
        .filter(r => r.chatId === chatId && r.isActive);

      if (userReminders.length === 0) {
        await this.bot.sendMessage(chatId, 'No active reminders found.');
        return;
      }

      const reminderList = userReminders.map(r => 
        `ID: ${r.id}\nInterval: ${r.interval} minutes\nCamera: ${r.cameraName || 'Default'}\nLast run: ${new Date(r.lastRun).toLocaleString()}`
      ).join('\n\n');

      await this.bot.sendMessage(chatId, `Active reminders:\n\n${reminderList}`);
    });

    // Handle /stop command
    this.bot.onText(/\/stop (.+)/, async (msg, match) => {
      const chatId = msg.chat.id;
      const userId = msg.from?.id;
      const reminderId = match?.[1]?.trim();
      
      if (!userId || !isUserAuthorized(userId)) {
        await this.handleUnauthorizedUser(msg);
        return;
      }
      
      if (!reminderId) {
        await this.bot.sendMessage(chatId, 'Please provide a reminder ID to stop.');
        return;
      }

      const reminder = this.reminders.get(reminderId);
      if (!reminder || reminder.chatId !== chatId) {
        await this.bot.sendMessage(chatId, 'Reminder not found or not owned by you.');
        return;
      }

      this.cleanupReminder(reminderId);
      await this.bot.sendMessage(chatId, `✅ Reminder ${reminderId} stopped.`);
    });

    // Handle callback queries (button clicks)
    this.bot.on('callback_query', (query) => {
      this.handleCallbackQuery(query);
    });

    // Handle text messages (for custom questions)
    this.bot.on('message', async (msg) => {
      if (msg.text && !msg.text.startsWith('/')) {
        const chatId = msg.chat.id;
        const userId = msg.from?.id;
        const menuState = this.menuStates.get(chatId);
        
        // Check authorization for text messages
        if (!userId || !isUserAuthorized(userId)) {
          await this.handleUnauthorizedUser(msg);
          return;
        }
        
        if (menuState?.currentMenu === 'waiting_custom_question' && menuState.selectedCamera) {
          // Check if user wants detailed analysis (starts with "detailed:" or "🧠")
          if (msg.text.toLowerCase().startsWith('detailed:') || msg.text.includes('🧠')) {
            const question = msg.text.replace(/^detailed:\s*/i, '').replace(/🧠\s*/, '');
            await this.handleDetailedAnalysis(chatId, menuState.selectedCamera);
          } else {
            await this.handleAIQuestion(chatId, menuState.selectedCamera, msg.text);
          }
          this.menuStates.delete(chatId); // Clear the waiting state
        } else if (menuState && menuState.currentMenu === 'reminder_custom_prompt' && menuState.selectedCamera && menuState.reminderInterval) {
          console.log('Processing custom reminder prompt');
          const customPrompt = msg.text?.trim();
          if (customPrompt && customPrompt.length > 0) {
            await this.createReminder(chatId, menuState.reminderInterval, menuState.selectedCamera, true, customPrompt);
          } else {
            await this.bot.sendMessage(chatId, '❌ Please provide a valid AI prompt.');
          }
          this.menuStates.delete(chatId); // Clear the waiting state
        }
      }
    });

    // Handle errors
    this.bot.on('error', (error) => {
      console.error('Telegram bot error:', error);
    });

    // Handle polling errors
    this.bot.on('polling_error', (error) => {
      console.error('Telegram polling error:', error);
      // Don't crash the server, just log the error
    });

    console.log('Telegram bot started');
  }

  private async handleUnauthorizedUser(msg: TelegramBot.Message) {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    const username = msg.from?.username;
    const firstName = msg.from?.first_name;
    const lastName = msg.from?.last_name;

    if (!userId) {
      await this.bot.sendMessage(chatId, 'Error: Could not identify user.');
      return;
    }

    // Check if user is already pending
    const pendingUsers = getPendingUsers();
    const isPending = pendingUsers.some(u => u.userId === userId);

    if (isPending) {
      await this.bot.sendMessage(chatId, 
        '⏳ **Access Request Pending**\n\n' +
        'Your request for access is currently being reviewed by the administrator.\n' +
        'You will be notified once your access is approved.\n\n' +
        'Please be patient while we review your request.',
        { parse_mode: 'Markdown' }
      );
    } else {
      // Add user to pending list
      addPendingUser(userId, { username, firstName, lastName });

      // Send message to user
      await this.bot.sendMessage(chatId, 
        '🔐 **Access Request Submitted**\n\n' +
        'Thank you for your interest in using the Ring Camera Bot!\n\n' +
        'Your request for access has been submitted to the administrator.\n' +
        'You will be notified once your access is approved.\n\n' +
        '**User ID:** `' + userId + '`\n' +
        '**Username:** ' + (username ? '@' + username : 'Not provided') + '\n' +
        '**Name:** ' + (firstName || '') + ' ' + (lastName || ''),
        { parse_mode: 'Markdown' }
      );

      // Send notification to admin
      await this.notifyAdminOfNewRequest(userId, username, firstName, lastName);
    }
  }

  private async notifyAdminOfNewRequest(userId: number, username?: string, firstName?: string, lastName?: string) {
    const userInfo = `**New Access Request**\n\n` +
      `**User ID:** \`${userId}\`\n` +
      `**Username:** ${username ? '@' + username : 'Not provided'}\n` +
      `**Name:** ${firstName || ''} ${lastName || ''}\n` +
      `**Time:** ${new Date().toLocaleString()}\n\n` +
      `**Commands:**\n` +
      `/admin approve ${userId} - Approve this user\n` +
      `/admin deny ${userId} - Deny this user\n` +
      `/admin list - View all pending requests`;

    await this.bot.sendMessage(ADMIN_USER_ID, userInfo, { parse_mode: 'Markdown' });
  }

  private async handleAdminCommand(msg: TelegramBot.Message) {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    if (userId !== ADMIN_USER_ID) {
      await this.bot.sendMessage(chatId, '❌ Access denied. Admin only.');
      return;
    }

    await this.showAdminMenu(chatId);
  }

  private async showAdminMenu(chatId: number) {
    const pendingCount = getPendingUsers().length;
    const authorizedCount = getAuthorizedUsers().length;
    
    await this.bot.sendMessage(chatId, 
      '🔧 **Admin Panel**\n\n' +
      `📋 Pending Requests: ${pendingCount}\n` +
      `👥 Authorized Users: ${authorizedCount}`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: `📋 Pending (${pendingCount})`, callback_data: 'admin_pending' },
              { text: `👥 Users (${authorizedCount})`, callback_data: 'admin_users' }
            ],
            [
              { text: '📊 Request History', callback_data: 'admin_history' },
              { text: '🗑️ Clear History', callback_data: 'admin_clear_history' }
            ],
            [
              { text: '📸 View Images', callback_data: 'admin_images' },
              { text: '🏠 Main Menu', callback_data: 'menu_main' }
            ]
          ]
        }
      }
    );
  }

  private async approveUser(adminChatId: number, targetUserId: number) {
    const pendingUsers = getPendingUsers();
    const user = pendingUsers.find(u => u.userId === targetUserId);

    if (!user) {
      await this.bot.sendMessage(adminChatId, `❌ User ${targetUserId} is not in the pending list.`);
      return;
    }

    // Add to authorized users
    addAuthorizedUser(targetUserId);
    removePendingUser(targetUserId);

    // Notify admin
    await this.bot.sendMessage(adminChatId, 
      `✅ **User Approved**\n\n` +
      `**User ID:** ${targetUserId}\n` +
      `**Username:** ${user.username ? '@' + user.username : 'Not provided'}\n` +
      `**Name:** ${user.firstName || ''} ${user.lastName || ''}\n\n` +
      `User has been granted access to the bot.`,
      { parse_mode: 'Markdown' }
    );

    // Notify user
    await this.bot.sendMessage(targetUserId, 
      '🎉 **Access Granted!**\n\n' +
      'Your request for access has been approved!\n\n' +
      'You can now use the bot. Send `/start` to begin.',
      { parse_mode: 'Markdown' }
    );
  }

  private async denyUser(adminChatId: number, targetUserId: number) {
    const pendingUsers = getPendingUsers();
    const user = pendingUsers.find(u => u.userId === targetUserId);

    if (!user) {
      await this.bot.sendMessage(adminChatId, `❌ User ${targetUserId} is not in the pending list.`);
      return;
    }

    removePendingUser(targetUserId);

    // Notify admin
    await this.bot.sendMessage(adminChatId, 
      `❌ **User Denied**\n\n` +
      `**User ID:** ${targetUserId}\n` +
      `**Username:** ${user.username ? '@' + user.username : 'Not provided'}\n` +
      `**Name:** ${user.firstName || ''} ${user.lastName || ''}\n\n` +
      `User has been denied access to the bot.`,
      { parse_mode: 'Markdown' }
    );

    // Notify user
    await this.bot.sendMessage(targetUserId, 
      '❌ **Access Denied**\n\n' +
      'Your request for access has been denied.\n\n' +
      'If you believe this is an error, please contact the administrator.',
      { parse_mode: 'Markdown' }
    );
  }

  private async removeUser(adminChatId: number, targetUserId: number) {
    const authorizedUsers = getAuthorizedUsers();
    
    if (!authorizedUsers.includes(targetUserId)) {
      await this.bot.sendMessage(adminChatId, `❌ User ${targetUserId} is not in the authorized list.`);
      return;
    }

    removeAuthorizedUser(targetUserId);

    // Notify admin
    await this.bot.sendMessage(adminChatId, 
      `🗑️ **User Removed**\n\n` +
      `**User ID:** ${targetUserId}\n\n` +
      `User has been removed from authorized users.`,
      { parse_mode: 'Markdown' }
    );

    // Notify user
    await this.bot.sendMessage(targetUserId, 
      '🔒 **Access Revoked**\n\n' +
      'Your access to the bot has been revoked.\n\n' +
      'If you need access again, please send `/start` to request it.',
      { parse_mode: 'Markdown' }
    );
  }

  private async listPendingUsers(chatId: number) {
    const pendingUsers = getPendingUsers();
    
    if (pendingUsers.length === 0) {
      await this.bot.sendMessage(chatId, '📋 **No Pending Requests**\n\nThere are no users waiting for approval.');
      return;
    }

    const userList = pendingUsers.map(user => 
      `**ID:** \`${user.userId}\`\n` +
      `**Username:** ${user.username ? '@' + user.username : 'Not provided'}\n` +
      `**Name:** ${user.firstName || ''} ${user.lastName || ''}\n` +
      `**Requested:** ${new Date(user.requestTime).toLocaleString()}\n` +
      `**Commands:** \`/admin approve ${user.userId}\` | \`/admin deny ${user.userId}\``
    ).join('\n\n');

    await this.bot.sendMessage(chatId, 
      `📋 **Pending Requests (${pendingUsers.length})**\n\n${userList}`,
      { parse_mode: 'Markdown' }
    );
  }

  private async listAuthorizedUsers(chatId: number) {
    const authorizedUsers = getAuthorizedUsers();
    
    if (authorizedUsers.length === 0) {
      await this.bot.sendMessage(chatId, '👥 **No Authorized Users**\n\nThere are no authorized users.');
      return;
    }

    const userList = authorizedUsers.map(userId => 
      `**ID:** \`${userId}\`\n` +
      `**Command:** \`/admin remove ${userId}\``
    ).join('\n\n');

    await this.bot.sendMessage(chatId, 
      `👥 **Authorized Users (${authorizedUsers.length})**\n\n${userList}`,
      { parse_mode: 'Markdown' }
    );
  }

  private async listPendingUsersWithButtons(chatId: number) {
    const pendingUsers = getPendingUsers();
    
    if (pendingUsers.length === 0) {
      await this.bot.sendMessage(chatId, 
        '📋 **No Pending Requests**\n\nThere are no users waiting for approval.',
        {
          reply_markup: {
            inline_keyboard: [[{ text: '🔙 Back to Admin', callback_data: 'admin_menu' }]]
          }
        }
      );
      return;
    }

    for (const user of pendingUsers) {
      const userName = user.username ? `@${user.username}` : `${user.firstName || ''} ${user.lastName || ''}`.trim();
      const userInfo = 
        `👤 **User Request**\n\n` +
        `**ID:** \`${user.userId}\`\n` +
        `**Name:** ${userName}\n` +
        `**Requested:** ${new Date(user.requestTime).toLocaleString()}`;

      await this.bot.sendMessage(chatId, userInfo, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Approve', callback_data: `admin_approve_${user.userId}` },
              { text: '❌ Deny', callback_data: `admin_deny_${user.userId}` }
            ]
          ]
        }
      });
    }

    await this.bot.sendMessage(chatId, 
      `📋 **Total Pending: ${pendingUsers.length}**`,
      {
        reply_markup: {
          inline_keyboard: [[{ text: '🔙 Back to Admin', callback_data: 'admin_menu' }]]
        }
      }
    );
  }

  private async listAuthorizedUsersWithButtons(chatId: number) {
    const authorizedUsers = getAuthorizedUsers();
    
    if (authorizedUsers.length === 0) {
      await this.bot.sendMessage(chatId, 
        '👥 **No Authorized Users**\n\nThere are no authorized users.',
        {
          reply_markup: {
            inline_keyboard: [[{ text: '🔙 Back to Admin', callback_data: 'admin_menu' }]]
          }
        }
      );
      return;
    }

    const userButtons = authorizedUsers.map(userId => [
      { text: `👤 User ${userId}`, callback_data: `admin_user_info_${userId}` },
      { text: '🗑️ Remove', callback_data: `admin_remove_${userId}` }
    ]);

    userButtons.push([{ text: '🔙 Back to Admin', callback_data: 'admin_menu' }]);

    await this.bot.sendMessage(chatId, 
      `👥 **Authorized Users (${authorizedUsers.length})**\n\nSelect a user to remove:`,
      {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: userButtons }
      }
    );
  }

  private async showRequestHistory(chatId: number, userId?: number) {
    try {
      console.log(`Showing request history for chat ${chatId}, user ${userId}`);
      const history = userId ? getRequestHistoryByUser(userId, 50) : getRequestHistory(50);
      console.log(`Found ${history.length} history entries`);
      
      if (history.length === 0) {
        const message = userId ? 
          `📊 **No request history found for user ${userId}**` : 
          '📊 **No request history found**\n\nRequest history will appear here after you use the bot features (snapshots, AI questions, etc.).';
        await this.bot.sendMessage(chatId, message, {
          reply_markup: {
            inline_keyboard: [[{ text: '🔙 Back to Admin', callback_data: 'admin_menu' }]]
          }
        });
        return;
      }

      const historyText = history.map(entry => {
        const date = new Date(entry.timestamp).toLocaleString();
        const user = entry.username ? `@${entry.username}` : `${entry.firstName || ''} ${entry.lastName || ''}`.trim();
        const status = entry.success ? '✅' : '❌';
        const camera = entry.camera ? ` (${entry.camera})` : '';
        const error = entry.errorMessage ? `\n   Error: ${entry.errorMessage}` : '';
        
        return `${status} **${entry.action}**${camera}\n` +
               `   User: ${user} (${entry.userId})\n` +
               `   Time: ${date}\n` +
               `   Details: ${entry.details}${error}`;
      }).join('\n\n');

      const title = userId ? 
        `📊 **Request History for User ${userId}** (Last 50)` : 
        '📊 **Request History** (Last 50)';

      // Split message if too long
      const maxLength = 4000;
      if (historyText.length > maxLength) {
        const chunks = [];
        let currentChunk = '';
        const entries = historyText.split('\n\n');
        
        for (const entry of entries) {
          if (currentChunk.length + entry.length + 2 > maxLength) {
            chunks.push(currentChunk);
            currentChunk = entry;
          } else {
            currentChunk += (currentChunk ? '\n\n' : '') + entry;
          }
        }
        if (currentChunk) chunks.push(currentChunk);

        await this.bot.sendMessage(chatId, title, { parse_mode: 'Markdown' });
        for (const chunk of chunks) {
          await this.bot.sendMessage(chatId, chunk, { parse_mode: 'Markdown' });
        }
      } else {
        await this.bot.sendMessage(chatId, `${title}\n\n${historyText}`, { parse_mode: 'Markdown' });
      }

    } catch (error) {
      console.error('Error showing request history:', error);
      await this.bot.sendMessage(chatId, '❌ Error retrieving request history');
    }
  }

  private async clearHistory(chatId: number) {
    try {
      clearRequestHistory();
      await this.bot.sendMessage(chatId, '✅ **Request history cleared successfully**', { 
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[{ text: '🔙 Back to Admin', callback_data: 'admin_menu' }]]
        }
      });
    } catch (error) {
      console.error('Error clearing request history:', error);
      await this.bot.sendMessage(chatId, '❌ Error clearing request history');
    }
  }

  private async handleAdminCallback(chatId: number, data: string, userId?: number) {
    if (userId !== ADMIN_USER_ID) {
      await this.bot.sendMessage(chatId, '❌ Access denied. Admin only.');
      return;
    }

    switch (data) {
      case 'admin_menu':
        await this.showAdminMenu(chatId);
        break;
      case 'admin_pending':
        await this.listPendingUsersWithButtons(chatId);
        break;
      case 'admin_users':
        await this.listAuthorizedUsersWithButtons(chatId);
        break;
      case 'admin_history':
        await this.showRequestHistory(chatId);
        break;
      case 'admin_clear_history':
        await this.confirmClearHistory(chatId);
        break;
      case 'admin_clear_history_confirm':
        await this.clearHistory(chatId);
        break;
      case 'admin_images':
        await this.showStoredImages(chatId);
        break;
      default:
        if (data.startsWith('admin_approve_')) {
          const targetUserId = parseInt(data.replace('admin_approve_', ''));
          await this.approveUser(chatId, targetUserId);
        } else if (data.startsWith('admin_deny_')) {
          const targetUserId = parseInt(data.replace('admin_deny_', ''));
          await this.denyUser(chatId, targetUserId);
        } else if (data.startsWith('admin_remove_')) {
          const targetUserId = parseInt(data.replace('admin_remove_', ''));
          await this.removeUser(chatId, targetUserId);
        }
        break;
    }
  }

  private async confirmClearHistory(chatId: number) {
    await this.bot.sendMessage(chatId, 
      '⚠️ **Confirm Action**\n\nAre you sure you want to clear all request history? This action cannot be undone.',
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Yes, Clear All', callback_data: 'admin_clear_history_confirm' },
              { text: '❌ Cancel', callback_data: 'admin_menu' }
            ]
          ]
        }
      }
    );
  }

  private async showStoredImages(chatId: number) {
    try {
      console.log(`Showing stored images for chat ${chatId}`);
      const imageData = await getStoredImages();
      console.log(`Found ${imageData.length} camera folders with images`);
      
      if (imageData.length === 0) {
        await this.bot.sendMessage(chatId, 
          '📸 **No Stored Images**\n\nNo images have been captured yet. Take some snapshots to see them here!',
          {
            reply_markup: {
              inline_keyboard: [[{ text: '🔙 Back to Admin', callback_data: 'admin_menu' }]]
            }
          }
        );
        return;
      }

      let totalImages = 0;
      const summary = imageData.map(camera => {
        totalImages += camera.images.length;
        return `📹 **${camera.camera}**: ${camera.images.length} images`;
      }).join('\n');

      await this.bot.sendMessage(chatId, 
        `📸 **Stored Images Summary**\n\n${summary}\n\n**Total**: ${totalImages} images\n\n` +
        `Visit the admin dashboard at http://localhost:3000/images.html to view all images.`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🌐 Open Web Gallery', url: 'http://localhost:3000/images.html' }],
              [{ text: '🔙 Back to Admin', callback_data: 'admin_menu' }]
            ]
          }
        }
      );

      // Send latest image from each camera
      for (const camera of imageData.slice(0, 3)) { // Limit to 3 cameras to avoid spam
        if (camera.images.length > 0) {
          const latestImage = camera.images[0];
          try {
            await this.bot.sendPhoto(chatId, `http://localhost:3000${latestImage.path}`, {
              caption: `📸 **${camera.camera}** (Latest)\n📅 ${latestImage.timestamp.toLocaleString()}`,
              parse_mode: 'Markdown'
            });
          } catch (error) {
            console.error(`Error sending image for ${camera.camera}:`, error);
          }
        }
      }
    } catch (error) {
      console.error('Error showing stored images:', error);
      await this.bot.sendMessage(chatId, '❌ Error retrieving stored images');
    }
  }

  private startReminder(reminder: Reminder) {
    const intervalMs = reminder.interval * 60 * 1000;
    const timeout = setInterval(async () => {
      if (!reminder.isActive) {
        // Clean up inactive reminder
        const interval = this.reminderIntervals.get(reminder.id);
        if (interval) {
          clearInterval(interval);
          this.reminderIntervals.delete(reminder.id);
        }
        return;
      }

      try {
        console.log(`Executing reminder ${reminder.id} for camera ${reminder.cameraName}`);
        const imageBase64 = await getSnapshotBase64(reminder.cameraName || '');
        const imageBuffer = Buffer.from(imageBase64, 'base64');
        
        const intervalText = reminder.interval >= 60 ? 
          `${Math.floor(reminder.interval / 60)} hour${Math.floor(reminder.interval / 60) > 1 ? 's' : ''}` :
          `${reminder.interval} minute${reminder.interval > 1 ? 's' : ''}`;
        
        if (reminder.isSmartReminder && reminder.aiPrompt) {
          // Smart reminder with AI analysis
          const analysis = await analyzeImage(imageBase64, reminder.aiPrompt);
          const caption = `🤖 **Smart AI Reminder**\n📹 Camera: ${reminder.cameraName}\n⏱️ Every ${intervalText}\n💭 Question: ${reminder.aiPrompt}\n\n**AI Analysis:** ${analysis}\n\n📅 ${new Date().toLocaleString()}`;
          
          await this.bot.sendPhoto(reminder.chatId, imageBuffer, { 
            caption,
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '🗑️ Stop Reminder', callback_data: `reminder_stop_${reminder.id}` },
                  { text: '📋 View All', callback_data: 'reminder_list' }
                ]
              ]
            }
          });
        } else {
          // Simple reminder with just snapshot
          const caption = `⏰ **Automated Reminder**\n📹 Camera: ${reminder.cameraName}\n⏱️ Every ${intervalText}\n📅 ${new Date().toLocaleString()}`;
          
          await this.bot.sendPhoto(reminder.chatId, imageBuffer, { 
            caption,
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '🗑️ Stop Reminder', callback_data: `reminder_stop_${reminder.id}` },
                  { text: '📋 View All', callback_data: 'reminder_list' }
                ]
              ]
            }
          });
        }
        
        reminder.lastRun = Date.now();
        this.saveReminders();
        
        console.log(`Reminder ${reminder.id} executed successfully`);
      } catch (error) {
        console.error(`Error in reminder ${reminder.id}:`, error);
        await this.bot.sendMessage(reminder.chatId, 
          `❌ **Reminder Error**\n\nFailed to take automated snapshot from **${reminder.cameraName}**:\n${(error as Error).message}`,
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '🗑️ Stop This Reminder', callback_data: `reminder_stop_${reminder.id}` }]
              ]
            }
          }
        );
      }
    }, intervalMs);

    this.reminderIntervals.set(reminder.id, timeout);
    console.log(`Started reminder ${reminder.id} with ${reminder.interval} minute interval`);
  }

  private cleanupReminder(reminderId: string) {
    const timeout = this.reminderIntervals.get(reminderId);
    if (timeout) {
      clearInterval(timeout);
      this.reminderIntervals.delete(reminderId);
    }
    
    const reminder = this.reminders.get(reminderId);
    if (reminder) {
      reminder.isActive = false;
      this.reminders.delete(reminderId);
      this.saveReminders();
    }
  }

  private saveReminders() {
    const config = getConfig();
    const remindersArray = Array.from(this.reminders.values());
    updateConfig({ ...config, telegramReminders: remindersArray });
  }

  private loadReminders() {
    const config = getConfig();
    if (config.telegramReminders) {
      config.telegramReminders.forEach((reminder: Reminder) => {
        if (reminder.isActive) {
          this.reminders.set(reminder.id, reminder);
          this.startReminder(reminder);
        }
      });
    }
  }

  public async sendMessage(chatId: number, message: string) {
    return this.bot.sendMessage(chatId, message);
  }

  public async sendPhoto(chatId: number, photo: Buffer, options?: TelegramBot.SendPhotoOptions) {
    return this.bot.sendPhoto(chatId, photo, options);
  }

  // Menu Methods
  private async showMainMenu(chatId: number, userId?: number) {
    try {
      const baseButtons = [
        [{ text: '📸 Take Snapshot', callback_data: 'menu_snapshot' }],
        [{ text: '🤖 Ask AI Question', callback_data: 'menu_ask' }],
        [{ text: '⏰ Manage Reminders', callback_data: 'menu_reminders' }],
        [{ text: '📋 List Cameras', callback_data: 'menu_cameras' }],
        [{ text: '❓ Help', callback_data: 'menu_help' }]
      ];

      // Add admin button only for the admin user
      if (userId === ADMIN_USER_ID) {
        baseButtons.push([{ text: '🔧 Admin Panel', callback_data: 'admin_menu' }]);
      }

      const keyboard = {
        inline_keyboard: baseButtons
      };

      const message = await this.bot.sendMessage(chatId, 
        '🏠 **Ring Camera Bot**\n\nWelcome! What would you like to do?', 
        { 
          parse_mode: 'Markdown',
          reply_markup: keyboard 
        }
      );

      this.menuStates.set(chatId, { 
        chatId, 
        currentMenu: 'main',
        lastMessageId: message.message_id 
      });
      
      console.log(`Main menu shown for chat ${chatId}`);
    } catch (error) {
      console.error('Error showing main menu:', error);
      await this.bot.sendMessage(chatId, 'Error showing menu. Please try /start again.');
    }
  }

  private async showCameraMenu(chatId: number, action: string) {
    try {
      const cameras = await getCameraNames();
      const keyboard = {
        inline_keyboard: [
          ...cameras.map(camera => [{
            text: camera,
            callback_data: `${action}_${Buffer.from(camera).toString('base64')}`
          }]),
          [{ text: '🔙 Back to Main Menu', callback_data: 'menu_main' }]
        ]
      };

      const message = await this.bot.sendMessage(chatId,
        `📹 Select a camera for ${action === 'snapshot' ? 'snapshot' : 'AI analysis'}:`,
        { reply_markup: keyboard }
      );

      this.menuStates.set(chatId, { 
        chatId, 
        currentMenu: 'camera_select',
        lastMessageId: message.message_id 
      });
    } catch (error) {
      console.error('Error in showCameraMenu:', error);
      await this.bot.sendMessage(chatId, `Error loading cameras: ${(error as Error).message}`);
    }
  }

  private async showQuestionMenu(chatId: number, cameraName: string) {
    const commonQuestions = [
      'Where are the garbage bins located?',
      'Is there anyone in the yard?',
      'What vehicles are parked outside?',
      'Is the driveway clear?',
      'What do you see in this image?'
    ];

    const keyboard = {
      inline_keyboard: [
        ...commonQuestions.map(q => [{
          text: q,
          callback_data: `ask_${Buffer.from(cameraName).toString('base64')}_${Buffer.from(q).toString('base64').substring(0, 20)}`
        }]),
        [{ text: '🧠 Detailed Analysis', callback_data: `ask_${Buffer.from(cameraName).toString('base64')}_detailed` }],
        [{ text: '✏️ Custom Question', callback_data: `ask_${Buffer.from(cameraName).toString('base64')}_custom` }],
        [{ text: '🔙 Back to Camera Selection', callback_data: 'menu_ask' }],
        [{ text: '🏠 Main Menu', callback_data: 'menu_main' }]
      ]
    };

    const message = await this.bot.sendMessage(chatId,
      `🤖 **AI Analysis for ${cameraName}**\n\nChoose a question or ask your own:`,
      { 
        parse_mode: 'Markdown',
        reply_markup: keyboard 
      }
    );

    this.menuStates.set(chatId, { 
      chatId, 
      currentMenu: 'question_select',
      selectedCamera: cameraName,
      lastMessageId: message.message_id 
    });
  }

  private async showRemindersMenu(chatId: number) {
    const userReminders = Array.from(this.reminders.values())
      .filter(r => r.chatId === chatId && r.isActive);

    const keyboard = {
      inline_keyboard: [
        [{ text: '➕ Add New Reminder', callback_data: 'reminder_add' }],
        ...(userReminders.length > 0 ? [
          [{ text: '📋 View Active Reminders', callback_data: 'reminder_list' }]
        ] : []),
        [{ text: '🔙 Back to Main Menu', callback_data: 'menu_main' }]
      ]
    };

    const message = await this.bot.sendMessage(chatId,
      '⏰ **Reminder Management**\n\nWhat would you like to do?',
      { 
        parse_mode: 'Markdown',
        reply_markup: keyboard 
      }
    );

    this.menuStates.set(chatId, { 
      chatId, 
      currentMenu: 'reminders',
      lastMessageId: message.message_id 
    });
  }

    private async handleCallbackQuery(query: TelegramBot.CallbackQuery) {
    const chatId = query.message?.chat.id;
    const data = query.data;
    const userId = query.from?.id;

    if (!chatId || !data) {
      console.log('No chatId or data in callback query');
      return;
    }

    console.log(`Callback query received: ${data} from chat ${chatId} by user ${userId}`);

    // Store user info in menu state for tracking
    if (query.from) {
      const currentState = this.menuStates.get(chatId);
      this.menuStates.set(chatId, {
        ...currentState,
        chatId,
        currentMenu: currentState?.currentMenu || 'main',
        user: query.from
      });
    }

    // Check authorization for all callback queries except admin commands
    if (!userId || (!isUserAuthorized(userId) && !data.startsWith('admin_'))) {
      console.log(`Unauthorized callback query from user ${userId}`);
      await this.bot.answerCallbackQuery(query.id, { text: 'Access denied. Please request access first.' });
      return;
    }

    try {
      // Acknowledge the callback query
      await this.bot.answerCallbackQuery(query.id);

      if (data === 'menu_main') {
        console.log('Showing main menu');
        await this.showMainMenu(chatId, userId);
      } else if (data === 'menu_snapshot') {
        console.log('Showing snapshot menu');
        await this.showCameraMenu(chatId, 'snapshot');
      } else if (data === 'menu_ask') {
        console.log('Showing ask menu');
        await this.showCameraMenu(chatId, 'ask');
      } else if (data === 'menu_reminders') {
        console.log('Showing reminders menu');
        await this.showRemindersMenu(chatId);
      } else if (data === 'menu_cameras') {
        console.log('Showing cameras list');
        await this.handleCamerasList(chatId);
      } else if (data === 'menu_help') {
        console.log('Showing help');
        await this.handleHelp(chatId);
      } else if (data.startsWith('snapshot_')) {
        const cameraNameBase64 = data.replace('snapshot_', '');
        const cameraName = Buffer.from(cameraNameBase64, 'base64').toString();
        console.log(`Taking snapshot from ${cameraName}`);
        await this.handleSnapshot(chatId, cameraName);
      } else if (data.startsWith('ask_')) {
        const parts = data.split('_');
        const cameraNameBase64 = parts[1];
        const cameraName = Buffer.from(cameraNameBase64, 'base64').toString();
        console.log(`Processing ask for camera: ${cameraName}`);
        
        // If this is just selecting a camera for asking questions, show the question menu
        if (parts.length === 2) {
          console.log('Showing question menu for camera');
          await this.showQuestionMenu(chatId, cameraName);
        } else if (parts[2] === 'custom') {
          console.log('Handling custom question');
          await this.handleCustomQuestion(chatId, cameraName);
        } else if (parts[2] === 'detailed') {
          console.log('Handling detailed analysis');
          await this.handleDetailedAnalysis(chatId, cameraName);
        } else {
          // For predefined questions, we need to decode the question
          const questionHash = parts[2];
          const commonQuestions = [
            'Where are the garbage bins located?',
            'Is there anyone in the yard?',
            'What vehicles are parked outside?',
            'Is the driveway clear?',
            'What do you see in this image?'
          ];
          
          // Find the question by matching the hash
          const question = commonQuestions.find(q => 
            Buffer.from(q).toString('base64').substring(0, 20) === questionHash
          ) || 'What do you see in this image?';
          
          console.log(`Asking question: ${question}`);
          await this.handleAIQuestion(chatId, cameraName, question);
        }
      } else if (data.startsWith('menu_ask_')) {
        const cameraNameBase64 = data.replace('menu_ask_', '');
        const cameraName = Buffer.from(cameraNameBase64, 'base64').toString();
        console.log(`Showing question menu for camera: ${cameraName}`);
        await this.showQuestionMenu(chatId, cameraName);
      } else if (data === 'reminder_add') {
        console.log('Adding reminder');
        await this.handleAddReminder(chatId);
      } else if (data === 'reminder_list') {
        console.log('Listing reminders');
        await this.handleListReminders(chatId);
      } else if (data.startsWith('reminder_')) {
        await this.handleReminderCallback(chatId, data, userId);
      } else if (data.startsWith('admin_')) {
        await this.handleAdminCallback(chatId, data, userId);
      } else {
        console.log(`Unknown callback data: ${data}`);
        await this.bot.sendMessage(chatId, `Unknown action: ${data}`);
      }
    } catch (error) {
      console.error('Error handling callback query:', error);
      await this.bot.sendMessage(chatId, `Error: ${(error as Error).message}`);
    }
  }

  private async handleSnapshot(chatId: number, cameraName: string) {
    const menuState = this.menuStates.get(chatId);
    try {
      await this.bot.sendMessage(chatId, `📸 Taking snapshot from ${cameraName}...`);
      const imageBase64 = await getSnapshotBase64(cameraName);
      const imageBuffer = Buffer.from(imageBase64, 'base64');
      
      await this.bot.sendPhoto(chatId, imageBuffer, { 
        caption: `📸 Snapshot from ${cameraName}`,
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔄 Take Another', callback_data: `snapshot_${Buffer.from(cameraName).toString('base64')}` }],
            [{ text: '🏠 Main Menu', callback_data: 'menu_main' }]
          ]
        }
      });

      // Track successful snapshot request
      if (menuState?.user) {
        this.trackRequest(menuState.user.id, menuState.user, 'Snapshot', 'Successfully took snapshot', cameraName, true);
      }
    } catch (error) {
      await this.bot.sendMessage(chatId, `Error taking snapshot: ${(error as Error).message}`);
      
      // Track failed snapshot request
      if (menuState?.user) {
        this.trackRequest(menuState.user.id, menuState.user, 'Snapshot', 'Failed to take snapshot', cameraName, false, (error as Error).message);
      }
    }
  }

  private async handleAIQuestion(chatId: number, cameraName: string, question: string) {
    const menuState = this.menuStates.get(chatId);
    try {
      await this.bot.sendMessage(chatId, `🤖 Analyzing ${cameraName} image...`);
      
      const imageBase64 = await getSnapshotBase64(cameraName);
      const analysis = await analyzeImage(imageBase64, question);
      const imageBuffer = Buffer.from(imageBase64, 'base64');
      
      const response = `📸 **${cameraName} Analysis**\n\n**Question:** ${question}\n\n**Answer:** ${analysis}`;
      
      await this.bot.sendPhoto(chatId, imageBuffer, {
        caption: response,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔄 Ask Another Question', callback_data: `menu_ask_${Buffer.from(cameraName).toString('base64')}` }],
            [{ text: '🏠 Main Menu', callback_data: 'menu_main' }]
          ]
        }
      });

      // Track successful AI question
      if (menuState?.user) {
        this.trackRequest(menuState.user.id, menuState.user, 'AI Question', `Asked: "${question}"`, cameraName, true);
      }
    } catch (error) {
      await this.bot.sendMessage(chatId, `Error analyzing image: ${(error as Error).message}`);
      
      // Track failed AI question
      if (menuState?.user) {
        this.trackRequest(menuState.user.id, menuState.user, 'AI Question', `Failed to ask: "${question}"`, cameraName, false, (error as Error).message);
      }
    }
  }

  private async handleCustomQuestion(chatId: number, cameraName: string) {
    await this.bot.sendMessage(chatId, 
      `✏️ Please type your question about the ${cameraName} camera.\n\nExample: "Where are the garbage bins located?"`,
      { reply_markup: { remove_keyboard: true } }
    );
    
    this.menuStates.set(chatId, { 
      chatId, 
      currentMenu: 'waiting_custom_question',
      selectedCamera: cameraName
    });
  }

  private async handleDetailedAnalysis(chatId: number, cameraName: string) {
    try {
      await this.bot.sendMessage(chatId, `🧠 Performing detailed analysis of ${cameraName} image...`);
      
      const imageBase64 = await getSnapshotBase64(cameraName);
      const result = await analyzeImageWithThinking(imageBase64, 'Provide a comprehensive security analysis of this image');
      const imageBuffer = Buffer.from(imageBase64, 'base64');
      
      const thinkingText = `🧠 **Detailed Analysis for ${cameraName}**\n\n` +
        `**Observations:**\n${result.thinking.observations.map(obs => `• ${obs}`).join('\n')}\n\n` +
        `**Analysis:** ${result.thinking.analysis}\n\n` +
        `**Confidence:** ${result.thinking.confidence}\n\n` +
        `**Final Assessment:**\n${result.answer}`;
      
      await this.bot.sendPhoto(chatId, imageBuffer, {
        caption: thinkingText,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔄 Another Analysis', callback_data: `ask_${Buffer.from(cameraName).toString('base64')}_detailed` }],
            [{ text: '🏠 Main Menu', callback_data: 'menu_main' }]
          ]
        }
      });
    } catch (error) {
      await this.bot.sendMessage(chatId, `Error performing detailed analysis: ${(error as Error).message}`);
    }
  }

  private async handleCamerasList(chatId: number) {
    try {
      const cameras = await getCameraNames();
      const cameraList = cameras.map((name, index) => `${index + 1}. ${name}`).join('\n');
      
      await this.bot.sendMessage(chatId, 
        `📹 **Available Cameras:**\n\n${cameraList}`,
        { 
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔙 Back to Main Menu', callback_data: 'menu_main' }]
            ]
          }
        }
      );
    } catch (error) {
      await this.bot.sendMessage(chatId, `Error getting cameras: ${(error as Error).message}`);
    }
  }

  private async handleHelp(chatId: number) {
    const helpText = `🤖 **Ring Camera Bot Help**\n\n` +
      `**Main Features:**\n` +
      `• 📸 Take snapshots from any camera\n` +
      `• 🤖 Ask AI questions about images\n` +
      `• ⏰ Set up automated reminders\n` +
      `• 📋 View all available cameras\n\n` +
      `**AI Questions Examples:**\n` +
      `• "Where are the garbage bins?"\n` +
      `• "Is there anyone in the yard?"\n` +
      `• "What vehicles are parked outside?"\n` +
      `• "Is the driveway clear?"\n\n` +
      `**Text Commands:**\n` +
      `/start - Show main menu\n` +
      `/help - Show this help\n` +
      `/remind [minutes] [camera] - Quick reminder setup\n` +
      `/reminders - List active reminders`;

    await this.bot.sendMessage(chatId, helpText, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔙 Back to Main Menu', callback_data: 'menu_main' }]
        ]
      }
    });
  }

  private async handleReminderCallback(chatId: number, data: string, userId?: number) {
    try {
      if (data.startsWith('reminder_type_')) {
        const reminderType = data.replace('reminder_type_', '') as 'simple' | 'smart';
        await this.showReminderIntervals(chatId, reminderType);
      } else if (data.startsWith('reminder_interval_')) {
        const parts = data.replace('reminder_interval_', '').split('_');
        const reminderType = parts[0] as 'simple' | 'smart';
        const interval = parseInt(parts[1]);
        await this.showCameraSelectionForReminder(chatId, interval, reminderType);
      } else if (data.startsWith('reminder_camera_')) {
        const parts = data.split('_');
        const reminderType = parts[2] as 'simple' | 'smart';
        const interval = parseInt(parts[3]);
        const cameraNameBase64 = parts[4];
        const cameraName = Buffer.from(cameraNameBase64, 'base64').toString();
        
        if (reminderType === 'smart') {
          await this.showAIPromptSelection(chatId, interval, cameraName);
        } else {
          await this.createReminder(chatId, interval, cameraName, false);
        }
      } else if (data.startsWith('reminder_prompt_')) {
        const parts = data.split('_');
        const interval = parseInt(parts[2]);
        const cameraNameBase64 = parts[3];
        const promptBase64 = parts[4];
        const cameraName = Buffer.from(cameraNameBase64, 'base64').toString();
        const prompt = Buffer.from(promptBase64, 'base64').toString();
        await this.createReminder(chatId, interval, cameraName, true, prompt);
      } else if (data.startsWith('reminder_custom_prompt_')) {
        const parts = data.split('_');
        const interval = parseInt(parts[3]);
        const cameraNameBase64 = parts[4];
        const cameraName = Buffer.from(cameraNameBase64, 'base64').toString();
        await this.handleCustomPromptInput(chatId, interval, cameraName);
      } else if (data.startsWith('reminder_stop_')) {
        const reminderId = data.replace('reminder_stop_', '');
        await this.stopReminder(chatId, reminderId);
      } else if (data.startsWith('reminder_test_')) {
        const reminderId = data.replace('reminder_test_', '');
        await this.testReminder(chatId, reminderId);
      }
    } catch (error) {
      console.error('Error handling reminder callback:', error);
      await this.bot.sendMessage(chatId, `❌ Error: ${(error as Error).message}`);
    }
  }

  private async showCameraSelectionForReminder(chatId: number, interval: number, reminderType: 'simple' | 'smart') {
    try {
      const cameras = await getCameraNames();
      
      if (cameras.length === 0) {
        await this.bot.sendMessage(chatId, 
          '❌ **No Cameras Found**\n\nNo Ring cameras are available.',
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: '🔙 Back to Reminders', callback_data: 'menu_reminders' }]
              ]
            }
          }
        );
        return;
      }

      const intervalText = interval >= 60 ? 
        `${Math.floor(interval / 60)} hour${Math.floor(interval / 60) > 1 ? 's' : ''}` :
        `${interval} minute${interval > 1 ? 's' : ''}`;

      const typeText = reminderType === 'smart' ? '🤖 Smart AI Reminder' : '📸 Simple Reminder';

      const cameraButtons = cameras.map(camera => [
        { 
          text: `📹 ${camera}`, 
          callback_data: `reminder_camera_${reminderType}_${interval}_${Buffer.from(camera).toString('base64')}` 
        }
      ]);

      cameraButtons.push([{ text: '🔙 Back to Intervals', callback_data: `reminder_type_${reminderType}` }]);

      await this.bot.sendMessage(chatId,
        `⏰ **${typeText} Setup**\n\n` +
        `⏱️ **Interval:** Every ${intervalText}\n\n` +
        `📹 **Select Camera:**`,
        {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: cameraButtons }
        }
      );
    } catch (error) {
      console.error('Error showing camera selection for reminder:', error);
      await this.bot.sendMessage(chatId, '❌ Error loading cameras');
    }
  }

  private async showAIPromptSelection(chatId: number, interval: number, cameraName: string) {
    const intervalText = interval >= 60 ? 
      `${Math.floor(interval / 60)} hour${Math.floor(interval / 60) > 1 ? 's' : ''}` :
      `${interval} minute${interval > 1 ? 's' : ''}`;

    const commonPrompts = [
      "Are the garbage bins on the street or driveway?",
      "Is anyone at the door or in the area?",
      "Are there any vehicles in the driveway?",
      "Is the area secure with no suspicious activity?",
      "What's the current weather conditions?",
      "Are there any packages delivered?"
    ];

    const promptButtons = commonPrompts.map(prompt => [
      { 
        text: `💭 ${prompt.length > 35 ? prompt.substring(0, 32) + '...' : prompt}`, 
        callback_data: `reminder_prompt_${interval}_${Buffer.from(cameraName).toString('base64')}_${Buffer.from(prompt).toString('base64')}` 
      }
    ]);

    promptButtons.push([
      { text: '✏️ Custom Prompt', callback_data: `reminder_custom_prompt_${interval}_${Buffer.from(cameraName).toString('base64')}` }
    ]);
    promptButtons.push([
      { text: '🔙 Back to Camera Selection', callback_data: `reminder_interval_smart_${interval}` }
    ]);

    await this.bot.sendMessage(chatId,
      `🤖 **Smart AI Reminder Setup**\n\n` +
      `📹 **Camera:** ${cameraName}\n` +
      `⏱️ **Interval:** Every ${intervalText}\n\n` +
      `💭 **Choose AI Prompt:**`,
      {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: promptButtons }
      }
    );
  }

  private async handleCustomPromptInput(chatId: number, interval: number, cameraName: string) {
    // Store the reminder setup state for custom prompt input
    this.menuStates.set(chatId, {
      chatId,
      currentMenu: 'reminder_custom_prompt',
      selectedCamera: cameraName,
      user: this.menuStates.get(chatId)?.user,
      reminderInterval: interval
    });

    await this.bot.sendMessage(chatId,
      `✏️ **Custom AI Prompt**\n\n` +
      `📹 **Camera:** ${cameraName}\n` +
      `⏱️ **Interval:** Every ${interval >= 60 ? `${Math.floor(interval / 60)} hour${Math.floor(interval / 60) > 1 ? 's' : ''}` : `${interval} minute${interval > 1 ? 's' : ''}`}\n\n` +
      `Please type your custom AI prompt for this smart reminder.\n\n` +
      `**Examples:**\n` +
      `• "Is my car parked in the driveway?"\n` +
      `• "Are there any people or animals in the yard?"\n` +
      `• "What's happening at the front entrance?"`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '❌ Cancel', callback_data: `reminder_interval_smart_${interval}` }]
          ]
        }
      }
    );
  }

  private async createReminder(chatId: number, interval: number, cameraName: string, isSmartReminder: boolean = false, aiPrompt?: string) {
    try {
      const id = `${chatId}_${Date.now()}`;
      const reminder: Reminder = {
        id,
        chatId,
        interval,
        cameraName,
        lastRun: Date.now(),
        isActive: true,
        isSmartReminder,
        aiPrompt
      };

      this.reminders.set(id, reminder);
      this.saveReminders();
      this.startReminder(reminder);

      const intervalText = interval >= 60 ? 
        `${Math.floor(interval / 60)} hour${Math.floor(interval / 60) > 1 ? 's' : ''}` :
        `${interval} minute${interval > 1 ? 's' : ''}`;

      // Track the reminder creation
      const menuState = this.menuStates.get(chatId);
      if (menuState?.user) {
        this.trackRequest(menuState.user.id, menuState.user, 'Reminder Created', `Set ${intervalText} reminder for ${cameraName}`, cameraName, true);
      }

      const reminderTypeText = isSmartReminder ? '🤖 Smart AI Reminder' : '📸 Simple Reminder';
      const promptText = aiPrompt ? `\n💭 **AI Prompt:** ${aiPrompt}` : '';
      
      await this.bot.sendMessage(chatId,
        `✅ **${reminderTypeText} Created Successfully!**\n\n` +
        `📹 **Camera:** ${cameraName}\n` +
        `⏱️ **Interval:** Every ${intervalText}${promptText}\n` +
        `🆔 **ID:** ${id.substring(0, 8)}...\n\n` +
        `Your first ${isSmartReminder ? 'AI analysis' : 'snapshot'} will be sent in ${intervalText}.`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '🔄 Test Now', callback_data: `reminder_test_${id}` },
                { text: '📋 View All', callback_data: 'reminder_list' }
              ],
              [{ text: '🔙 Back to Reminders', callback_data: 'menu_reminders' }]
            ]
          }
        }
      );
    } catch (error) {
      console.error('Error creating reminder:', error);
      await this.bot.sendMessage(chatId, `❌ Error creating reminder: ${(error as Error).message}`);
    }
  }

  private async stopReminder(chatId: number, reminderId: string) {
    try {
      const reminder = this.reminders.get(reminderId);
      if (!reminder || reminder.chatId !== chatId) {
        await this.bot.sendMessage(chatId, '❌ Reminder not found or access denied.');
        return;
      }

      reminder.isActive = false;
      this.reminders.delete(reminderId);
      
      const interval = this.reminderIntervals.get(reminderId);
      if (interval) {
        clearInterval(interval);
        this.reminderIntervals.delete(reminderId);
      }

      this.saveReminders();

      // Track the reminder stop
      const menuState = this.menuStates.get(chatId);
      if (menuState?.user) {
        this.trackRequest(menuState.user.id, menuState.user, 'Reminder Stopped', `Stopped reminder for ${reminder.cameraName}`, reminder.cameraName, true);
      }

      await this.bot.sendMessage(chatId,
        `🛑 **Reminder Stopped**\n\n` +
        `The reminder for **${reminder.cameraName}** has been stopped and removed.`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '📋 View Remaining', callback_data: 'reminder_list' }],
              [{ text: '🔙 Back to Reminders', callback_data: 'menu_reminders' }]
            ]
          }
        }
      );
    } catch (error) {
      console.error('Error stopping reminder:', error);
      await this.bot.sendMessage(chatId, `❌ Error stopping reminder: ${(error as Error).message}`);
    }
  }

  private async testReminder(chatId: number, reminderId: string) {
    try {
      const reminder = this.reminders.get(reminderId);
      if (!reminder || reminder.chatId !== chatId) {
        await this.bot.sendMessage(chatId, '❌ Reminder not found or access denied.');
        return;
      }

      await this.bot.sendMessage(chatId, `🔄 Testing reminder for **${reminder.cameraName}**...`, { parse_mode: 'Markdown' });

      // Send a test snapshot
      const imageBase64 = await getSnapshotBase64(reminder.cameraName || '');
      const imageBuffer = Buffer.from(imageBase64, 'base64');

      await this.bot.sendPhoto(chatId, imageBuffer, {
        caption: `🧪 **Test Reminder**\n📹 Camera: ${reminder.cameraName}\n📅 ${new Date().toLocaleString()}`,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📋 Back to Reminders', callback_data: 'reminder_list' }]
          ]
        }
      });

      // Track the test
      const menuState = this.menuStates.get(chatId);
      if (menuState?.user) {
        this.trackRequest(menuState.user.id, menuState.user, 'Reminder Test', `Tested reminder for ${reminder.cameraName}`, reminder.cameraName, true);
      }

    } catch (error) {
      console.error('Error testing reminder:', error);
      await this.bot.sendMessage(chatId, `❌ Error testing reminder: ${(error as Error).message}`);
    }
  }

  private async handleAddReminder(chatId: number) {
    await this.bot.sendMessage(chatId,
      '⏰ **Add New Reminder**\n\nChoose reminder type:',
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '📸 Simple Reminder', callback_data: 'reminder_type_simple' },
              { text: '🤖 Smart AI Reminder', callback_data: 'reminder_type_smart' }
            ],
            [{ text: '🔙 Back to Reminders', callback_data: 'menu_reminders' }]
          ]
        }
      }
    );
  }

  private async showReminderIntervals(chatId: number, reminderType: 'simple' | 'smart') {
    const typeText = reminderType === 'smart' ? '🤖 Smart AI Reminder' : '📸 Simple Reminder';
    
    await this.bot.sendMessage(chatId,
      `⏰ **${typeText}**\n\nSelect an interval:`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '⏱️ 15 min', callback_data: `reminder_interval_${reminderType}_15` },
              { text: '⏱️ 30 min', callback_data: `reminder_interval_${reminderType}_30` }
            ],
            [
              { text: '⏱️ 1 hour', callback_data: `reminder_interval_${reminderType}_60` },
              { text: '⏱️ 2 hours', callback_data: `reminder_interval_${reminderType}_120` }
            ],
            [
              { text: '⏱️ 6 hours', callback_data: `reminder_interval_${reminderType}_360` },
              { text: '⏱️ 12 hours', callback_data: `reminder_interval_${reminderType}_720` }
            ],
            [{ text: '🔙 Back to Type Selection', callback_data: 'reminder_add' }]
          ]
        }
      }
    );
  }

  private async handleListReminders(chatId: number) {
    const userReminders = Array.from(this.reminders.values())
      .filter(r => r.chatId === chatId && r.isActive);

    if (userReminders.length === 0) {
      await this.bot.sendMessage(chatId, 
        '⏰ **No Active Reminders**\n\nYou don\'t have any active reminders set up yet.',
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '➕ Add New Reminder', callback_data: 'reminder_add' }],
              [{ text: '🔙 Back to Reminders', callback_data: 'menu_reminders' }]
            ]
          }
        }
      );
      return;
    }

    // Send each reminder as a separate message with control buttons
    for (const reminder of userReminders) {
      const intervalText = reminder.interval >= 60 ? 
        `${Math.floor(reminder.interval / 60)} hour${Math.floor(reminder.interval / 60) > 1 ? 's' : ''}` :
        `${reminder.interval} minute${reminder.interval > 1 ? 's' : ''}`;
      
      const reminderInfo = 
        `⏰ **Active Reminder**\n\n` +
        `📹 **Camera:** ${reminder.cameraName || 'Default'}\n` +
        `⏱️ **Interval:** Every ${intervalText}\n` +
        `📅 **Last run:** ${new Date(reminder.lastRun).toLocaleString()}\n` +
        `🆔 **ID:** ${reminder.id.substring(0, 8)}...`;

      await this.bot.sendMessage(chatId, reminderInfo, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🗑️ Stop Reminder', callback_data: `reminder_stop_${reminder.id}` },
              { text: '🔄 Test Now', callback_data: `reminder_test_${reminder.id}` }
            ]
          ]
        }
      });
    }

    // Summary message
    await this.bot.sendMessage(chatId, 
      `📊 **Total Active Reminders:** ${userReminders.length}`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔙 Back to Reminders', callback_data: 'menu_reminders' }]
          ]
        }
      }
    );
  }
}

export const telegramService = new TelegramService();
