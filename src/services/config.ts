import fs from 'fs';
import path from 'path';

export interface RequestHistoryEntry {
  id: string;
  userId: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  timestamp: number;
  action: string;
  details: string;
  camera?: string;
  success: boolean;
  errorMessage?: string;
}

export interface AlertRule {
  id: string;
  cameraName: string;
  enabled: boolean;
  idleThresholdMinutes: number; // Alert if no motion for X minutes
  activeHours: {
    start: number; // 0-23 hour
    end: number;   // 0-23 hour
  };
  cooldownMinutes: number; // Don't alert again for X minutes
  aiCriteria?: {
    enabled: boolean;
    prompt: string; // AI prompt to check (e.g., "Is someone sleeping?")
  };
  lastTriggered?: number; // Timestamp of last alert
}

export interface AppConfig {
  ringRefreshToken?: string;
  openaiApiKey?: string;
  cameraName?: string;
  telegramReminders?: Array<{
    id: string;
    chatId: number;
    interval: number;
    cameraName?: string;
    lastRun: number;
    isActive: boolean;
  }>;
  telegramAuthorizedUsers?: number[];
  telegramPendingUsers?: Array<{
    userId: number;
    username?: string;
    firstName?: string;
    lastName?: string;
    requestTime: number;
  }>;
  requestHistory?: RequestHistoryEntry[];
  alertRules?: AlertRule[];
}

const CONFIG_FILE = path.resolve(process.cwd(), 'config.json');

let currentConfig: AppConfig = {};

function loadConfigFromDisk(): AppConfig {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    const parsed = JSON.parse(raw) as AppConfig;
    return parsed || {};
  } catch {
    return {};
  }
}

function saveConfigToDisk(config: AppConfig): void {
  const tmpFile = `${CONFIG_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(config, null, 2), 'utf8');
  fs.renameSync(tmpFile, CONFIG_FILE);
}

export function getConfig(): AppConfig {
  if (!Object.keys(currentConfig).length) {
    currentConfig = loadConfigFromDisk();
  }
  return currentConfig;
}

export function updateConfig(partial: AppConfig): AppConfig {
  const prev = getConfig();
  const next: AppConfig = { ...prev };
  if (partial.ringRefreshToken !== undefined && partial.ringRefreshToken !== '') {
    next.ringRefreshToken = partial.ringRefreshToken;
  }
  if (partial.openaiApiKey !== undefined && partial.openaiApiKey !== '') {
    next.openaiApiKey = partial.openaiApiKey;
  }
  if (partial.cameraName !== undefined) {
    next.cameraName = partial.cameraName;
  }
  if (partial.telegramReminders !== undefined) {
    next.telegramReminders = partial.telegramReminders;
  }
  if (partial.telegramAuthorizedUsers !== undefined) {
    next.telegramAuthorizedUsers = partial.telegramAuthorizedUsers;
  }
  if (partial.telegramPendingUsers !== undefined) {
    next.telegramPendingUsers = partial.telegramPendingUsers;
  }
  if (partial.requestHistory !== undefined) {
    next.requestHistory = partial.requestHistory;
  }
  if (partial.alertRules !== undefined) {
    next.alertRules = partial.alertRules;
  }
  currentConfig = next;
  saveConfigToDisk(currentConfig);
  return currentConfig;
}

export function getRingRefreshToken(): string | undefined {
  return getConfig().ringRefreshToken || process.env.RING_REFRESH_TOKEN;
}

export function getOpenAIApiKey(): string | undefined {
  return getConfig().openaiApiKey || process.env.OPENAI_API_KEY;
}

export function getDefaultCameraName(): string | undefined {
  return getConfig().cameraName || process.env.CAMERA_NAME;
}

export function isUserAuthorized(userId: number): boolean {
  const config = getConfig();
  return config.telegramAuthorizedUsers?.includes(userId) || false;
}

export function addAuthorizedUser(userId: number): void {
  const config = getConfig();
  const authorizedUsers = config.telegramAuthorizedUsers || [];
  if (!authorizedUsers.includes(userId)) {
    authorizedUsers.push(userId);
    updateConfig({ ...config, telegramAuthorizedUsers: authorizedUsers });
  }
}

export function removeAuthorizedUser(userId: number): void {
  const config = getConfig();
  const authorizedUsers = config.telegramAuthorizedUsers || [];
  const filteredUsers = authorizedUsers.filter(id => id !== userId);
  updateConfig({ ...config, telegramAuthorizedUsers: filteredUsers });
}

export function addPendingUser(userId: number, userInfo: { username?: string; firstName?: string; lastName?: string }): void {
  const config = getConfig();
  const pendingUsers = config.telegramPendingUsers || [];
  const existingIndex = pendingUsers.findIndex(u => u.userId === userId);
  
  if (existingIndex === -1) {
    pendingUsers.push({
      userId,
      username: userInfo.username,
      firstName: userInfo.firstName,
      lastName: userInfo.lastName,
      requestTime: Date.now()
    });
    updateConfig({ ...config, telegramPendingUsers: pendingUsers });
  }
}

export function removePendingUser(userId: number): void {
  const config = getConfig();
  const pendingUsers = config.telegramPendingUsers || [];
  const filteredUsers = pendingUsers.filter(u => u.userId !== userId);
  updateConfig({ ...config, telegramPendingUsers: filteredUsers });
}

export function getPendingUsers(): Array<{
  userId: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  requestTime: number;
}> {
  const config = getConfig();
  return config.telegramPendingUsers || [];
}

export function getAuthorizedUsers(): number[] {
  const config = getConfig();
  return config.telegramAuthorizedUsers || [];
}

// Request History Management
export function addRequestHistory(entry: Omit<RequestHistoryEntry, 'id' | 'timestamp'>): void {
  const config = getConfig();
  const historyEntry: RequestHistoryEntry = {
    ...entry,
    id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
    timestamp: Date.now()
  };
  
  const currentHistory = config.requestHistory || [];
  // Keep only last 1000 entries to prevent file from growing too large
  const updatedHistory = [historyEntry, ...currentHistory].slice(0, 1000);
  
  updateConfig({ requestHistory: updatedHistory });
}

export function getRequestHistory(limit?: number): RequestHistoryEntry[] {
  const config = getConfig();
  const history = config.requestHistory || [];
  return limit ? history.slice(0, limit) : history;
}

export function getRequestHistoryByUser(userId: number, limit?: number): RequestHistoryEntry[] {
  const config = getConfig();
  const history = config.requestHistory || [];
  const userHistory = history.filter(entry => entry.userId === userId);
  return limit ? userHistory.slice(0, limit) : userHistory;
}

export function clearRequestHistory(): void {
  updateConfig({ requestHistory: [] });
}

// Alert Rules Management
export function addAlertRule(rule: Omit<AlertRule, 'id' | 'lastTriggered'>): void {
  const config = getConfig();
  const newRule: AlertRule = {
    ...rule,
    id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
    lastTriggered: undefined
  };
  const rules = config.alertRules || [];
  updateConfig({ alertRules: [...rules, newRule] });
}

export function updateAlertRule(id: string, updates: Partial<AlertRule>): void {
  const config = getConfig();
  const rules = config.alertRules || [];
  const index = rules.findIndex(rule => rule.id === id);
  if (index !== -1) {
    const updatedRule = { ...rules[index], ...updates };
    updateConfig({ alertRules: [...rules.slice(0, index), updatedRule, ...rules.slice(index + 1)] });
  }
}

export function deleteAlertRule(id: string): void {
  const config = getConfig();
  const rules = config.alertRules || [];
  const filteredRules = rules.filter(rule => rule.id !== id);
  updateConfig({ alertRules: filteredRules });
}

export function getAlertRules(): AlertRule[] {
  const config = getConfig();
  return config.alertRules || [];
}

export function getAlertRulesByCamera(cameraName: string): AlertRule[] {
  const config = getConfig();
  return config.alertRules?.filter(rule => rule.cameraName === cameraName) || [];
}

export function getAlertRulesByUser(userId: number): AlertRule[] {
  const config = getConfig();
  return config.alertRules?.filter(rule => rule.aiCriteria?.enabled && rule.aiCriteria.prompt.includes(`@${userId}`)) || [];
}

export function getAlertRulesByCameraAndUser(cameraName: string, userId: number): AlertRule[] {
  const config = getConfig();
  return config.alertRules?.filter(rule => rule.cameraName === cameraName && rule.aiCriteria?.enabled && rule.aiCriteria.prompt.includes(`@${userId}`)) || [];
}


