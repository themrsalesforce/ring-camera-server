import TelegramBot from 'node-telegram-bot-api';
import { getSnapshotBase64, getCameraNames } from './ring.js';
import { 
  getConfig, 
  updateConfig, 
  isUserAuthorized, 
  addAuthorizedUser, 
  removeAuthorizedUser, 
  addPendingUser, 
  removePendingUser, 
  getPendingUsers, 
  getAuthorizedUsers 
} from './config.js';
import { analyzeImage, analyzeImageWithThinking } from './vision.js';

interface MenuState {
  chatId: number;
  currentMenu: string;
  selectedCamera?: string;
  lastMessageId?: number;
}

const ADMIN_USER_ID = 426747873; // @shmuelchaikin's user ID

interface Reminder {
  id: string;
  chatId: number;
  interval: number; // in minutes
  cameraName?: string;
  lastRun: number;
  isActive: boolean;
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

      await this.showMainMenu(chatId);
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

      this.stopReminder(reminderId);
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
    const text = msg.text || '';

    if (userId !== ADMIN_USER_ID) {
      await this.bot.sendMessage(chatId, '❌ You do not have permission to use admin commands.');
      return;
    }

    const parts = text.split(' ');
    const command = parts[1];
    const targetUserId = parseInt(parts[2]);

    switch (command) {
      case 'approve':
        if (isNaN(targetUserId)) {
          await this.bot.sendMessage(chatId, '❌ Please provide a valid user ID: `/admin approve [user_id]`');
          return;
        }
        await this.approveUser(chatId, targetUserId);
        break;

      case 'deny':
        if (isNaN(targetUserId)) {
          await this.bot.sendMessage(chatId, '❌ Please provide a valid user ID: `/admin deny [user_id]`');
          return;
        }
        await this.denyUser(chatId, targetUserId);
        break;

      case 'list':
        await this.listPendingUsers(chatId);
        break;

      case 'users':
        await this.listAuthorizedUsers(chatId);
        break;

      case 'remove':
        if (isNaN(targetUserId)) {
          await this.bot.sendMessage(chatId, '❌ Please provide a valid user ID: `/admin remove [user_id]`');
          return;
        }
        await this.removeUser(chatId, targetUserId);
        break;

      default:
        await this.bot.sendMessage(chatId, 
          '🔧 **Admin Commands**\n\n' +
          '`/admin approve [user_id]` - Approve a user\n' +
          '`/admin deny [user_id]` - Deny a user\n' +
          '`/admin remove [user_id]` - Remove authorized user\n' +
          '`/admin list` - View pending requests\n' +
          '`/admin users` - View authorized users',
          { parse_mode: 'Markdown' }
        );
    }
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

  private startReminder(reminder: Reminder) {
    const intervalMs = reminder.interval * 60 * 1000;
    const timeout = setInterval(async () => {
      if (!reminder.isActive) {
        this.stopReminder(reminder.id);
        return;
      }

      try {
        const imageBase64 = await getSnapshotBase64(reminder.cameraName || '');
        const imageBuffer = Buffer.from(imageBase64, 'base64');
        const caption = `🕐 Automated snapshot${reminder.cameraName ? ` from ${reminder.cameraName}` : ''}`;
        
        await this.bot.sendPhoto(reminder.chatId, imageBuffer, { caption });
        reminder.lastRun = Date.now();
        this.saveReminders();
      } catch (error) {
        console.error(`Error in reminder ${reminder.id}:`, error);
        await this.bot.sendMessage(reminder.chatId, 
          `❌ Error taking automated snapshot: ${(error as Error).message}`
        );
      }
    }, intervalMs);

    this.reminderIntervals.set(reminder.id, timeout);
  }

  private stopReminder(reminderId: string) {
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
  private async showMainMenu(chatId: number) {
    try {
      const keyboard = {
        inline_keyboard: [
          [{ text: '📸 Take Snapshot', callback_data: 'menu_snapshot' }],
          [{ text: '🤖 Ask AI Question', callback_data: 'menu_ask' }],
          [{ text: '⏰ Manage Reminders', callback_data: 'menu_reminders' }],
          [{ text: '📋 List Cameras', callback_data: 'menu_cameras' }],
          [{ text: '❓ Help', callback_data: 'menu_help' }]
        ]
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
        await this.showMainMenu(chatId);
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
    } catch (error) {
      await this.bot.sendMessage(chatId, `Error taking snapshot: ${(error as Error).message}`);
    }
  }

  private async handleAIQuestion(chatId: number, cameraName: string, question: string) {
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
    } catch (error) {
      await this.bot.sendMessage(chatId, `Error analyzing image: ${(error as Error).message}`);
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

  private async handleAddReminder(chatId: number) {
    await this.bot.sendMessage(chatId,
      '⏰ **Add New Reminder**\n\n' +
      'Use the command format:\n' +
      '`/remind [minutes] [camera]`\n\n' +
      'Examples:\n' +
      '• `/remind 30 Front Door`\n' +
      '• `/remind 60 Backyard`\n' +
      '• `/remind 120` (default camera)',
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

  private async handleListReminders(chatId: number) {
    const userReminders = Array.from(this.reminders.values())
      .filter(r => r.chatId === chatId && r.isActive);

    if (userReminders.length === 0) {
      await this.bot.sendMessage(chatId, 'No active reminders found.', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔙 Back to Reminders', callback_data: 'menu_reminders' }]
          ]
        }
      });
      return;
    }

    const reminderList = userReminders.map(r => 
      `**ID:** ${r.id}\n` +
      `**Interval:** ${r.interval} minutes\n` +
      `**Camera:** ${r.cameraName || 'Default'}\n` +
      `**Last run:** ${new Date(r.lastRun).toLocaleString()}`
    ).join('\n\n');

    await this.bot.sendMessage(chatId, 
      `⏰ **Active Reminders:**\n\n${reminderList}`,
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
