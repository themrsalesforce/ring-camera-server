# Ring Camera Server with Telegram Bot

A Node.js server that integrates Ring cameras with a Telegram bot for remote monitoring and automated snapshots.

## Features

- **Ring Camera Integration**: Connect to your Ring cameras and get snapshots
- **Telegram Bot**: Control your cameras and set up automated reminders via Telegram
- **Automated Reminders**: Schedule periodic snapshots from specific cameras
- **Web Interface**: Manage configuration and view camera feeds via web browser
- **Bin Classification**: AI-powered bin status detection (requires OpenAI API)
- **AI Image Analysis**: Ask questions about camera images and get AI-powered answers

## Setup

### Prerequisites

1. Node.js (v20 or higher)
2. Ring account with cameras
3. Telegram bot token (create your own at @BotFather)
4. OpenAI API key (for AI analysis features)

### Installation

1. **Clone the repository:**
   ```bash
   git clone <your-repo-url>
   cd ring-camera-server
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Set up configuration:**
   ```bash
   cp config.example.json config.json
   ```
   Then edit `config.json` with your credentials.

4. **Configure your Ring account:**
   - Start the server: `npm run dev`
   - Visit `http://localhost:3000`
   - Use the Ring authentication interface to get your refresh token
   - Add the refresh token to your `config.json`

5. **Set up Telegram bot:**
   - Create a bot with @BotFather on Telegram
   - Get your bot token
   - Update the token in `src/services/telegram.ts` (line with `ADMIN_USER_ID`)

6. **Configure OpenAI API:**
   - Get an API key from [OpenAI](https://platform.openai.com/api-keys)
   - Add it to your `config.json`

7. **Set up admin access:**
   - Update the `ADMIN_USER_ID` in `src/services/telegram.ts` with your Telegram user ID
   - Add your user ID to `telegramAuthorizedUsers` in `config.json`

### Configuration

The bot uses a `config.json` file for all configuration. Copy `config.example.json` to `config.json` and fill in your values:

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
