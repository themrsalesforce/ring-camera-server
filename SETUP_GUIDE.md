# Quick Setup Guide

## 🚀 Get Started in 5 Minutes

### 1. **Prerequisites**
- Node.js (v20 or higher)
- Ring account with cameras
- Telegram account
- OpenAI API key

### 2. **Installation**
```bash
# Clone the repository
git clone <your-repo-url>
cd ring-camera-server

# Install dependencies
npm install

# Copy configuration template
cp config.example.json config.json
```

### 3. **Configure Your Bot**

#### **A. Create Telegram Bot**
1. Message @BotFather on Telegram
2. Send `/newbot`
3. Choose a name and username
4. Copy the bot token

#### **B. Get Your Telegram User ID**
1. Message @userinfobot on Telegram
2. Copy your user ID

#### **C. Update Configuration**
Edit `src/services/telegram.ts`:
```typescript
const ADMIN_USER_ID = YOUR_TELEGRAM_USER_ID; // Replace with your ID
```

Edit `config.json`:
```json
{
  "ringRefreshToken": "",
  "openaiApiKey": "your_openai_api_key",
  "cameraName": "Front Door",
  "telegramAuthorizedUsers": [YOUR_TELEGRAM_USER_ID],
  "telegramPendingUsers": [],
  "telegramReminders": []
}
```

### 4. **Set Up Ring Integration**
```bash
# Start the server
npm run dev

# Visit http://localhost:3000
# Use the Ring authentication interface
# Copy the refresh token to config.json
```

### 5. **Test Your Bot**
1. Message your bot on Telegram
2. Send `/start`
3. You should see the main menu!

## 🔧 Troubleshooting

### **Bot not responding?**
- Check that the server is running
- Verify your bot token is correct
- Make sure your user ID is in `telegramAuthorizedUsers`

### **Ring cameras not working?**
- Verify your Ring refresh token
- Check that your cameras are online
- Try the web interface at `http://localhost:3000`

### **AI analysis not working?**
- Verify your OpenAI API key
- Check that you have credits in your OpenAI account

## 📞 Support

If you need help:
1. Check the main README.md for detailed documentation
2. Verify all configuration steps are completed
3. Check the server logs for error messages

## 🔒 Security Notes

- Keep your `config.json` file secure
- Don't share your API keys
- Only approve users you trust
- The bot is only accessible to approved users
