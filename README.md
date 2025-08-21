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

## Telegram Bot Usage

Message your bot on Telegram and send `/start` to access the interactive menu system:

- 📸 **Snapshots** - Take instant photos from any camera
- 🤖 **AI Analysis** - Ask questions about camera images (powered by GPT-4o)  
- ⏰ **Reminders** - Set up automated snapshots
- 🔧 **Admin Panel** - User management and system monitoring (admin only)


## Web Dashboard

Visit `http://localhost:3000` for:

- 🌐 **Setup Wizard** - Easy configuration interface
- 📊 **Request History** - Monitor all bot activity  
- 📸 **Image Gallery** - View all captured snapshots
- ⚙️ **System Settings** - Manage configuration

## Development

```bash
npm run dev      # Start development server
npm run build    # Build for production
```

That's it! Your Ring Camera Server is ready to use. 🎉
