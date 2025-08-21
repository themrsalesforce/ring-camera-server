# Ring Camera Server with Telegram Bot

A Node.js server that integrates Ring cameras with a Telegram bot for remote monitoring and automated snapshots.

## Features

- **Ring Camera Integration**: Connect to your Ring cameras and get snapshots
- **Telegram Bot**: Control your cameras and set up automated reminders via Telegram
- **Automated Reminders**: Schedule periodic snapshots from specific cameras
- **Web Interface**: Manage configuration and view camera feeds via web browser
- **Bin Classification**: AI-powered bin status detection (requires OpenAI API)
- **AI Image Analysis**: Ask questions about camera images and get AI-powered answers

## 🚀 Quick Setup

### Prerequisites

1. Node.js (v20 or higher)
2. Ring account with cameras
3. OpenAI API key (for AI analysis features)

### Installation

1. **Clone and install:**
   ```bash
   git clone https://github.com/themrsalesforce/ring-camera-server.git
   cd ring-camera-server
   npm install
   ```

2. **Start the server:**
   ```bash
   npm run dev
   ```

3. **Complete setup via web interface:**
   - Open http://localhost:3000
   - Click "🚀 Start Setup"
   - Follow the 4-step setup wizard:
     - **Step 1**: Create Telegram bot and get your User ID
     - **Step 2**: Authenticate with Ring account
     - **Step 3**: Add OpenAI API key
     - **Step 4**: Complete setup

4. **Start using your bot:**
   - Message your bot on Telegram
   - Send `/start` to see the interactive menu

**That's it!** No code editing required - everything is configured through the web interface.

## 🌐 Web Setup Interface

The setup wizard provides a user-friendly interface for configuring your Ring Camera Server:

### Setup Steps

1. **Telegram Bot Setup**
   - Instructions for creating a bot with @BotFather
   - Get your bot token and Telegram User ID
   - Automatic configuration of admin permissions

2. **Ring Authentication**
   - Secure popup window for Ring login
   - Automatic 2FA handling
   - Generates and stores refresh token

3. **OpenAI Integration**
   - Simple API key configuration
   - Direct link to OpenAI API keys page

4. **Auto-Configuration**
   - Automatically updates all configuration files
   - Sets up admin permissions
   - Initializes user whitelist

### Manual Configuration (Advanced)

If you prefer manual configuration, the bot uses a `config.json` file. Copy `config.example.json` to `config.json` and fill in your values:

```json
{
  "ringRefreshToken": "your_ring_refresh_token_here",
  "openaiApiKey": "your_openai_api_key_here", 
  "cameraName": "Front Door",
  "telegramAuthorizedUsers": [your_telegram_user_id],
  "telegramPendingUsers": [],
  "telegramReminders": []
}
```

### Environment Variables (Alternative)

You can also use environment variables instead of config.json:

- `RING_REFRESH_TOKEN`: Your Ring refresh token
- `OPENAI_API_KEY`: Your OpenAI API key
- `CAMERA_NAME`: Default camera name
- `TELEGRAM_BOT_TOKEN`: Your Telegram bot token

### Security Features

- **Admin Approval System**: Only approved users can access the bot
- **User Whitelist**: Pre-approved users stored in configuration
- **Request Management**: Admin can approve/deny access requests
- **Secure Storage**: Sensitive data stored locally in config.json

## Telegram Bot Usage

Once the server is running, the Telegram bot will be active. The bot now features an **interactive menu system** for easy navigation!

### Getting Started
- Send `/start` to see the main menu with buttons
- Use the inline buttons to navigate through options
- No need to remember complex commands - just tap buttons!

### Interactive Menu Features

**Main Menu Options:**
- 📸 **Take Snapshot** - Select a camera and get a snapshot
- 🤖 **Ask AI Question** - Choose a camera and ask questions with AI analysis
- ⏰ **Manage Reminders** - Set up and manage automated reminders
- 📋 **List Cameras** - View all available cameras
- ❓ **Help** - Get detailed help information

**AI Analysis Features:**
- Pre-defined common questions (garbage bins, people detection, vehicles, etc.)
- Custom question input
- **Snapshots included with every AI response**
- Easy camera selection from your available cameras

### Text Commands (Legacy)
- `/start` - Show interactive main menu
- `/help` - Show help information
- `/cameras` - List all available Ring cameras
- `/snapshot` - Quick snapshot menu
- `/ask` - Quick AI analysis menu

### Automated Reminders

- `/remind [minutes] [camera]` - Set up automated reminders
  - Example: `/remind 30 Front Door` - Send snapshots every 30 minutes from "Front Door" camera
  - Example: `/remind 60` - Send snapshots every hour from default camera

- `/reminders` - List all active reminders for your chat
- `/stop [reminder_id]` - Stop a specific reminder

### How to Use the Interactive Menu

1. **Start the bot**: Send `/start`
2. **Take a snapshot**: 
   - Tap "📸 Take Snapshot"
   - Select your camera from the list
   - Get the snapshot with action buttons

3. **Ask AI questions**:
   - Tap "🤖 Ask AI Question"
   - Select your camera
   - Choose from pre-defined questions or tap "✏️ Custom Question"
   - **Get both AI analysis AND snapshot in response**

4. **Manage reminders**:
   - Tap "⏰ Manage Reminders"
   - Add new reminders or view existing ones
   - Use text commands for quick setup

### Examples

```
# Interactive Menu Flow:
/start → 📸 Take Snapshot → Select Camera → Get Snapshot
/start → 🤖 Ask AI Question → Select Camera → Choose Question → Get Analysis + Snapshot

# Text Commands (for quick access):
/remind 15 Backyard    # Send snapshots every 15 minutes from Backyard camera
/remind 120            # Send snapshots every 2 hours from default camera
/reminders             # See all your active reminders
/stop 1234567890_123   # Stop reminder with ID 1234567890_123
```

## Web Interface

Visit `http://localhost:3000` to:

- Configure Ring authentication
- Set up OpenAI API key
- View camera snapshots
- Check bin status (if OpenAI is configured)
- Manage Telegram reminders

## API Endpoints

- `GET /cameras` - List available cameras
- `GET /api/snapshot?camera=name` - Get camera snapshot
- `GET /bins/status?camera=name` - Check bin status (requires OpenAI)
- `POST /api/analyze` - Analyze camera image with AI (requires OpenAI)
- `GET /api/telegram/reminders` - List active Telegram reminders
- `POST /api/telegram/test` - Send test message to Telegram

## Development

```bash
npm run dev      # Start development server with hot reload
npm run build    # Build for production
npm start        # Start production server
```

## Security Notes

- The Telegram bot token is included in the code for convenience but should be moved to environment variables in production
- Ring refresh tokens and API keys are stored locally in `config.json`
- Consider using HTTPS in production environments

## Troubleshooting

1. **Bot not responding**: Check that the server is running and the bot token is correct
2. **Camera not found**: Verify your Ring authentication and camera names
3. **Reminders not working**: Check server logs for errors and ensure the bot has permission to send photos
