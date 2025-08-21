import 'dotenv/config';
import express from 'express';
import path from 'path';
import { getCameraNames, getSnapshotBase64 } from './services/ring.js';
import { classifyBins, analyzeImage } from './services/vision.js';
import { getConfig, updateConfig, getDefaultCameraName } from './services/config.js';
import { startRingAuth, verifyRingTwoFactor } from './services/ringAuth.js';
import './services/telegram.js';

const app = express();
app.use(express.json({ limit: '1mb' }));
const port = Number(process.env.PORT || 3000);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/cameras', async (_req, res) => {
  try {
    const names = await getCameraNames();
    res.json({ cameras: names });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.get('/bins/status', async (req, res) => {
  try {
    const cameraName = (req.query.camera as string) || getDefaultCameraName() || '';
    const imageBase64 = await getSnapshotBase64(cameraName);

    const result = await classifyBins(imageBase64);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.post('/api/analyze', async (req, res) => {
  try {
    const { camera, question } = req.body as { camera?: string; question: string };
    if (!question) {
      return res.status(400).json({ error: 'question is required' });
    }

    const cameraName = camera || getDefaultCameraName() || '';
    const imageBase64 = await getSnapshotBase64(cameraName);
    const analysis = await analyzeImage(imageBase64, question);
    
    res.json({ 
      camera: cameraName,
      question,
      answer: analysis 
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Configuration endpoints
app.get('/api/config', (_req, res) => {
  const cfg = getConfig();
  res.json({
    ...cfg,
    ringRefreshToken: cfg.ringRefreshToken ? '***stored***' : undefined,
    openaiApiKey: cfg.openaiApiKey ? '***stored***' : undefined,
  });
});

app.post('/api/config', (req, res) => {
  const { ringRefreshToken, openaiApiKey, cameraName } = req.body as {
    ringRefreshToken?: string;
    openaiApiKey?: string;
    cameraName?: string;
  };
  const cfg = updateConfig({ ringRefreshToken, openaiApiKey, cameraName });
  res.json({ ok: true, cameraName: cfg.cameraName });
});

app.get('/api/cameras', async (_req, res) => {
  try {
    const names = await getCameraNames();
    res.json({ cameras: names });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.get('/api/snapshot', async (req, res) => {
  try {
    const cameraName = (req.query.camera as string) || getDefaultCameraName() || '';
    const imageBase64 = await getSnapshotBase64(cameraName);
    const img = Buffer.from(imageBase64, 'base64');
    res.setHeader('Content-Type', 'image/jpeg');
    res.send(img);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Ring web auth
app.post('/api/ring/auth/start', async (req, res) => {
  const { email, password } = req.body as { email: string; password: string };
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  try {
    const result = await startRingAuth(email, password);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.post('/api/ring/auth/verify', async (req, res) => {
  const { code } = req.body as { code: string };
  if (!code) return res.status(400).json({ error: 'code required' });
  try {
    const result = await verifyRingTwoFactor(code);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// Telegram bot endpoints
app.get('/api/telegram/reminders', (_req, res) => {
  const config = getConfig();
  res.json({ reminders: config.telegramReminders || [] });
});

app.post('/api/telegram/test', async (req, res) => {
  const { chatId, message } = req.body as { chatId: number; message: string };
  if (!chatId || !message) {
    return res.status(400).json({ error: 'chatId and message required' });
  }
  
  try {
    const { telegramService } = await import('./services/telegram.js');
    await telegramService.sendMessage(chatId, message);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.get('/api/telegram/status', async (_req, res) => {
  try {
    const { telegramService } = await import('./services/telegram.js');
    res.json({ 
      status: 'ok', 
      message: 'Telegram bot is running',
      menuStates: Array.from(telegramService['menuStates'].keys()).length
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Setup endpoints
app.get('/api/setup/status', (_req, res) => {
  const config = getConfig();
  const isSetup = !!(
    config.ringRefreshToken && 
    config.openaiApiKey && 
    config.telegramAuthorizedUsers?.length
  );
  
  res.json({ 
    isSetup,
    hasRingToken: !!config.ringRefreshToken,
    hasOpenAI: !!config.openaiApiKey,
    hasAuthorizedUsers: !!(config.telegramAuthorizedUsers?.length)
  });
});

app.post('/api/setup/complete', async (req, res) => {
  try {
    const { 
      telegramBotToken, 
      adminUserId, 
      ringRefreshToken, 
      defaultCamera, 
      openaiApiKey 
    } = req.body;

    // Validate required fields
    if (!telegramBotToken || !adminUserId || !ringRefreshToken || !openaiApiKey) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Update configuration
    const config = updateConfig({
      ringRefreshToken,
      openaiApiKey,
      cameraName: defaultCamera,
      telegramAuthorizedUsers: [adminUserId],
      telegramPendingUsers: [],
      telegramReminders: []
    });

    // Update Telegram bot token in the service
    // Note: This requires restarting the server to take effect
    const fs = await import('fs');
    const path = await import('path');
    
    // Read the telegram service file
    const telegramServicePath = path.resolve(process.cwd(), 'src/services/telegram.ts');
    let telegramServiceContent = fs.readFileSync(telegramServicePath, 'utf8');
    
    // Update the admin user ID and bot token
    telegramServiceContent = telegramServiceContent.replace(
      /const ADMIN_USER_ID = \d+;/,
      `const ADMIN_USER_ID = ${adminUserId};`
    );
    
    telegramServiceContent = telegramServiceContent.replace(
      /const token = process\.env\.TELEGRAM_BOT_TOKEN \|\| '[^']*';/,
      `const token = process.env.TELEGRAM_BOT_TOKEN || '${telegramBotToken}';`
    );
    
    // Write the updated file
    fs.writeFileSync(telegramServicePath, telegramServiceContent, 'utf8');

    res.json({ 
      success: true, 
      message: 'Setup completed successfully. Please restart the server to activate the Telegram bot.',
      config: {
        hasRingToken: true,
        hasOpenAI: true,
        hasAuthorizedUsers: true,
        defaultCamera: defaultCamera || 'Not set'
      }
    });

  } catch (error) {
    console.error('Setup completion error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Static frontend
app.use(express.static(path.resolve(process.cwd(), 'public')));

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on http://localhost:${port}`);
});


