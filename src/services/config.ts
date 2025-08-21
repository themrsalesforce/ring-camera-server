import fs from 'fs';
import path from 'path';

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


