# Ring Camera Server

A comprehensive Ring camera management system with Telegram bot integration, AI-powered image analysis, and smart motion alerts.

## 🚀 Features

- **📸 Camera Management**: View and control all Ring cameras
- **🤖 AI Image Analysis**: Ask questions about camera snapshots using GPT-4o
- **📱 Telegram Bot**: Full-featured bot with interactive menus and admin controls
- **⏰ Smart Reminders**: Automated snapshots with optional AI analysis
- **🚨 Motion Alerts**: Intelligent rule-based motion detection and alerts
- **👥 User Management**: Admin-controlled access with approval system
- **📊 Request History**: Track all bot interactions and system usage
- **🖼️ Image Gallery**: Local storage and web-based image management
- **🌐 Web Dashboard**: Modern web interface for camera control and monitoring
- **⚙️ Web Setup**: Easy configuration through web-based setup wizard

## 🚨 Smart Motion Alerts

The system includes a sophisticated rule engine for motion alerts:

- **Idle Threshold Detection**: Alert when motion occurs after a period of inactivity
- **Time-based Rules**: Configure active hours for different alert types
- **AI-powered Analysis**: Optional AI criteria for intelligent alert filtering
- **Cooldown Management**: Prevent alert spam with configurable cooldown periods
- **Per-camera Configuration**: Different rules for different cameras
- **Telegram Integration**: Instant alerts with snapshots and AI analysis

### Alert Rule Examples:
- **"Boys Room Idle Entry"**: Alert when motion after 10min idle + AI confirms someone is awake
- **"Front Door Business Hours"**: Alert during 8AM-6PM only, 30min idle threshold
- **"Night Movement"**: Alert during 10PM-6AM with AI movement detection

## 🛠️ Setup

### Quick Start
1. **Clone the repository**:
   ```bash
   git clone https://github.com/themrsalesforce/ring-camera-server.git
   cd ring-camera-server
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Start the server**:
   ```bash
   npm run dev
   ```

4. **Access the web setup**:
   Open `http://localhost:3000` and follow the setup wizard

### Configuration
The web setup wizard will guide you through:
- **Telegram Bot Token**: Create a bot via @BotFather
- **Admin User ID**: Your Telegram user ID for admin access
- **Ring Authentication**: Login to Ring and get refresh token
- **OpenAI API Key**: For AI image analysis features

## 📱 Telegram Bot Usage

### Main Commands
- `/start` - Access the main menu (requires authorization)
- `/help` - Show help information
- `/admin` - Admin panel (admin only)

### Interactive Features
- **📸 Take Snapshot**: Select camera and capture image
- **🤖 Ask AI Question**: Ask questions about camera images
- **⏰ Manage Reminders**: Create smart or simple automated reminders
- **📋 List Cameras**: View all available cameras
- **🚨 Manage Alerts**: Configure motion alert rules (admin only)

### Admin Features
- **👥 User Management**: Approve/deny user access requests
- **📊 Request History**: View system usage and interactions
- **🖼️ Image Gallery**: Browse stored camera images
- **🚨 Alert Rules**: Create and manage motion alert rules

## 🌐 Web Dashboard

Access the web interface at `http://localhost:3000`:

- **📸 Camera Controls**: View cameras and take snapshots
- **📺 Live View**: Real-time camera monitoring
- **📊 Request History**: System usage analytics
- **🖼️ Image Gallery**: Browse stored images
- **⚙️ Admin Panel**: User and system management

## 🔧 API Endpoints

### Camera Management
- `GET /api/cameras` - List all cameras
- `GET /api/snapshot?camera=<name>` - Get camera snapshot
- `POST /api/analyze` - AI image analysis

### Alert Management
- `GET /api/alerts` - List alert rules
- `POST /api/alerts` - Create new alert rule
- `PUT /api/alerts/:id` - Update alert rule
- `DELETE /api/alerts/:id` - Delete alert rule
- `GET /api/alerts/status` - Alert service status

### System Management
- `GET /api/history` - Request history
- `GET /api/images` - Stored images
- `GET /api/config` - System configuration

## 🏗️ Architecture

- **Backend**: Node.js with Express.js
- **Ring Integration**: ring-client-api for camera control
- **AI Analysis**: OpenAI GPT-4o for image understanding
- **Telegram Bot**: node-telegram-bot-api for bot functionality
- **Storage**: Local file system for images and configuration
- **Frontend**: HTML/CSS/JavaScript for web interface

## 📁 Project Structure

```
ring-camera-server/
├── src/
│   ├── services/
│   │   ├── ring.ts          # Ring camera integration
│   │   ├── telegram.ts      # Telegram bot functionality
│   │   ├── vision.ts        # AI image analysis
│   │   ├── alerts.ts        # Motion alert system
│   │   ├── config.ts        # Configuration management
│   │   └── ringAuth.ts      # Ring authentication
│   └── server.ts            # Main server application
├── public/
│   ├── images/              # Stored camera images
│   ├── index.html           # Main dashboard
│   ├── setup.html           # Setup wizard
│   └── ...                  # Other web pages
├── config.json              # System configuration
└── package.json             # Dependencies
```

## 🔒 Security Features

- **Admin-only Access**: Sensitive features require admin authorization
- **User Approval System**: New users must be approved by admin
- **Secure Configuration**: Sensitive data stored securely
- **Request Logging**: All interactions tracked for security

## 🚀 Advanced Features

### Smart Reminders
- **Simple Reminders**: Regular snapshots at configurable intervals
- **AI Reminders**: Snapshots with AI analysis and insights
- **Flexible Scheduling**: 1 minute to 12 hour intervals

### Motion Alert Rules
- **Idle Detection**: Alert when motion occurs after inactivity
- **Time Windows**: Configure active hours for different scenarios
- **AI Criteria**: Optional AI analysis for intelligent filtering
- **Cooldown Management**: Prevent alert spam

### Image Management
- **Local Storage**: All images stored locally for privacy
- **Organized Structure**: Images organized by camera and timestamp
- **Web Gallery**: Easy browsing and management interface
- **Telegram Integration**: Send images directly via bot

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🆘 Support

For issues and questions:
1. Check the existing issues
2. Create a new issue with detailed information
3. Include logs and error messages

---

**Built with ❤️ for Ring camera enthusiasts**
