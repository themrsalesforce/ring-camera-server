import { RingApi } from 'ring-client-api';
import { getConfig, getAlertRulesByCamera, updateAlertRule } from './config.js';
import { getSnapshotBase64 } from './ring.js';
import { analyzeImage } from './vision.js';

interface MotionState {
  cameraName: string;
  lastMotion: number;
  isActive: boolean;
}

class AlertsService {
  private ringApi: RingApi | null = null;
  private motionStates = new Map<string, MotionState>();
  private isInitialized = false;

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      const config = getConfig();
      if (!config.ringRefreshToken) {
        console.log('Alerts: No Ring refresh token available');
        return;
      }

      this.ringApi = new RingApi({
        refreshToken: config.ringRefreshToken,
        cameraStatusPollingSeconds: 20,
        locationModePollingSeconds: 20,
      });

      // Subscribe to motion events for all cameras
      const cameras = await this.ringApi.getCameras();
      
      for (const camera of cameras) {
        const cameraName = camera.name;
        
        // Initialize motion state
        this.motionStates.set(cameraName, {
          cameraName,
          lastMotion: Date.now(),
          isActive: false
        });

        // Subscribe to motion events if available
        if (camera.onNewDing && typeof camera.onNewDing.subscribe === 'function') {
          try {
            camera.onNewDing.subscribe(async (ding) => {
              console.log(`Motion detected on ${cameraName}`);
              await this.handleMotionEvent(cameraName, ding);
            });
            console.log(`Alerts: Subscribed to motion events for ${cameraName}`);
          } catch (error) {
            console.error(`Alerts: Failed to subscribe to motion events for ${cameraName}:`, error);
          }
        } else {
          console.log(`Alerts: Motion events not available for ${cameraName}`);
        }
      }

      this.isInitialized = true;
      console.log('Alerts: Service initialized successfully');
    } catch (error) {
      console.error('Alerts: Failed to initialize:', error);
    }
  }

  private async handleMotionEvent(cameraName: string, ding: any): Promise<void> {
    try {
      // Update motion state
      const motionState = this.motionStates.get(cameraName);
      if (motionState) {
        motionState.lastMotion = Date.now();
        motionState.isActive = true;
      }

      // Check alert rules for this camera
      const rules = getAlertRulesByCamera(cameraName);
      
      for (const rule of rules) {
        if (!rule.enabled) continue;
        
        const shouldAlert = await this.evaluateRule(rule, cameraName);
        if (shouldAlert) {
          await this.triggerAlert(rule, cameraName);
        }
      }
    } catch (error) {
      console.error(`Alerts: Error handling motion event for ${cameraName}:`, error);
    }
  }

  private async evaluateRule(rule: any, cameraName: string): Promise<boolean> {
    try {
      const now = Date.now();
      const currentHour = new Date().getHours();

      // Check cooldown
      if (rule.lastTriggered && (now - rule.lastTriggered) < (rule.cooldownMinutes * 60 * 1000)) {
        return false;
      }

      // Check active hours
      if (currentHour < rule.activeHours.start || currentHour > rule.activeHours.end) {
        return false;
      }

      // Check idle threshold
      const motionState = this.motionStates.get(cameraName);
      if (motionState) {
        const idleTime = now - motionState.lastMotion;
        if (idleTime < (rule.idleThresholdMinutes * 60 * 1000)) {
          return false;
        }
      }

      // Check AI criteria if enabled
      if (rule.aiCriteria?.enabled && rule.aiCriteria.prompt) {
        try {
          const snapshot = await getSnapshotBase64(cameraName);
          const aiResult = await analyzeImage(snapshot, rule.aiCriteria.prompt);
          
          // Simple check: if AI response contains "yes", "true", "detected", etc.
          const positiveKeywords = ['yes', 'true', 'detected', 'present', 'awake', 'active'];
          const isPositive = positiveKeywords.some(keyword => 
            aiResult.toLowerCase().includes(keyword)
          );
          
          if (!isPositive) {
            return false;
          }
        } catch (error) {
          console.error(`Alerts: AI evaluation failed for ${cameraName}:`, error);
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error(`Alerts: Error evaluating rule for ${cameraName}:`, error);
      return false;
    }
  }

  private async triggerAlert(rule: any, cameraName: string): Promise<void> {
    try {
      // Update last triggered timestamp
      updateAlertRule(rule.id, { lastTriggered: Date.now() });

      // Get snapshot
      const snapshot = await getSnapshotBase64(cameraName);
      const imageBuffer = Buffer.from(snapshot, 'base64');

      // Send Telegram alert
      const { TelegramService } = await import('./telegram.js');
      const telegramService = new TelegramService();
      
      const alertMessage = `🚨 **Motion Alert**\n📹 Camera: ${cameraName}\n⏰ Time: ${new Date().toLocaleString()}\n📋 Rule: ${rule.idleThresholdMinutes}min idle threshold`;
      
      // Add AI analysis if available
      let fullMessage = alertMessage;
      if (rule.aiCriteria?.enabled && rule.aiCriteria.prompt) {
        try {
          const aiResult = await analyzeImage(snapshot, rule.aiCriteria.prompt);
          fullMessage += `\n🤖 AI Analysis: ${aiResult}`;
        } catch (error) {
          console.error('Alerts: Failed to get AI analysis for alert:', error);
        }
      }

      // Send to all authorized users
      const config = getConfig();
      const authorizedUsers = config.telegramAuthorizedUsers || [];
      
      for (const userId of authorizedUsers) {
        try {
          await telegramService.bot.sendPhoto(userId, imageBuffer, {
            caption: fullMessage,
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '🔕 Mute for 1 hour', callback_data: `alert_mute_${rule.id}_60` }],
                [{ text: '🔕 Mute for 24 hours', callback_data: `alert_mute_${rule.id}_1440` }],
                [{ text: '⚙️ Manage Alerts', callback_data: 'admin_alerts' }]
              ]
            }
          });
        } catch (error) {
          console.error(`Alerts: Failed to send alert to user ${userId}:`, error);
        }
      }

      console.log(`Alerts: Alert triggered for ${cameraName} (Rule: ${rule.id})`);
    } catch (error) {
      console.error(`Alerts: Error triggering alert for ${cameraName}:`, error);
    }
  }

  getMotionStates(): Map<string, MotionState> {
    return this.motionStates;
  }

  isServiceInitialized(): boolean {
    return this.isInitialized;
  }
}

// Export singleton instance
export const alertsService = new AlertsService();
