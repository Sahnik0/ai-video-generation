# AI Video Generation Platform with YouTube Integration

## 🚀 Features

- **AI-Powered Video Generation**: Generate videos from any topic using Gemini AI
- **Multi-Language Support**: 11 Indian languages + English
- **Two Generation Modes**:
  - **Generic**: Fast photo slideshow with Ken Burns effects
  - **Detailed**: Custom Remotion animations with content-specific visuals
- **YouTube Integration**: Videos uploaded directly to YouTube as unlisted
- **Cron Job Scheduler**: Schedule automatic video generation
- **No Local Storage**: Videos are uploaded directly to YouTube (temp files only)

## 📋 Prerequisites

- Node.js 18+ and npm
- MongoDB database
- Google Cloud Console account (for Gemini API & YouTube API)
- Sarvam AI API key

## 🔧 Setup Instructions

### 1. Install Dependencies

```bash
# Backend
cd backend
npm install

# Frontend
cd frontend
npm install
```

### 2. Configure Environment Variables

Update `backend/.env` with your credentials:

```env
# Gemini AI
GEMINI_API_KEY=your-gemini-api-key

# Sarvam TTS
SARVAM_API_KEY=your-sarvam-api-key

# MongoDB
MONGODB_URI=your-mongodb-connection-string

# YouTube OAuth (see setup below)
YOUTUBE_CLIENT_ID=your-oauth-client-id.apps.googleusercontent.com
YOUTUBE_CLIENT_SECRET=your-oauth-client-secret
YOUTUBE_REDIRECT_URI=http://localhost:4000/api/youtube/oauth2callback
YOUTUBE_REFRESH_TOKEN=your-refresh-token-after-first-auth

# Server
PORT=4000
NEXT_PUBLIC_API_BASE=http://localhost:4000
```

### 3. YouTube API Setup

#### Step 1: Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable **YouTube Data API v3**:
   - Go to "APIs & Services" → "Library"
   - Search for "YouTube Data API v3"
   - Click "Enable"

#### Step 2: Create OAuth 2.0 Credentials

1. Go to "APIs & Services" → "Credentials"
2. Click "Create Credentials" → "OAuth client ID"
3. Select "Web application"
4. Add authorized redirect URI:
   ```
   http://localhost:4000/api/youtube/oauth2callback
   ```
5. Copy the **Client ID** and **Client Secret** to your `.env` file

#### Step 3: Get Refresh Token

1. Start your backend server:
   ```bash
   cd backend
   npm run dev
   ```

2. Visit the OAuth URL shown in console or navigate to:
   ```
   http://localhost:4000/api/youtube/auth
   ```

3. Click the authorization URL, sign in with your Google account

4. Grant permissions for YouTube upload

5. Copy the **refresh token** displayed on the callback page

6. Add it to `.env`:
   ```env
   YOUTUBE_REFRESH_TOKEN=your-refresh-token-here
   ```

7. Restart the backend server

### 4. Run the Application

```bash
# Terminal 1 - Backend
cd backend
npm run dev

# Terminal 2 - Frontend
cd frontend
npm run dev
```

Access the app at `http://localhost:3000`

## 📅 Cron Job Scheduler

### Creating a Scheduled Job

1. Navigate to the "Scheduled Video Jobs" section in the dashboard
2. Click "+ New Job"
3. Configure:
   - **Topic**: Video topic (e.g., "History of Rome")
   - **Language**: Select from 11 supported languages
   - **Mode**: Generic or Detailed
   - **Schedule**: Choose preset or custom cron expression

### Cron Expression Examples

```bash
0 9 * * *       # Every day at 9:00 AM UTC
0 10 * * 1      # Every Monday at 10:00 AM UTC
0 */6 * * *     # Every 6 hours
0 0 1 * *       # First day of every month at midnight
```

### Cron Job API Endpoints

```bash
# List all cron jobs
GET /api/cron

# Create new cron job
POST /api/cron
Body: { topic, language, mode, schedule, isActive }

# Toggle job active status
POST /api/cron/:id/toggle

# Delete cron job
DELETE /api/cron/:id
```

## 🎥 Video Generation Flow

### Generic Mode
1. Gemini generates structured script
2. AI agent orchestrates image search from Unsplash
3. Sarvam AI generates voice narration
4. FFmpeg renders video with Ken Burns effects
5. **Video uploaded to YouTube as unlisted**
6. Local temp files deleted

### Detailed Mode
1. Gemini generates detailed script
2. Sarvam AI generates per-section narration
3. Gemini writes custom Remotion animation code
4. Remotion renders animated scenes
5. **Video uploaded to YouTube as unlisted**
6. Local temp files deleted

## 🗄️ Database Schema

### Video Model
```javascript
{
  topic: String,
  topicHash: String,
  title: String,
  youtubeVideoId: String,      // YouTube video ID
  youtubeUrl: String,           // Full YouTube URL
  youtubeUploadedAt: Date,
  status: String,               // "generating" | "completed" | "failed"
  language: String,
  mode: String,                 // "generic" | "detailed"
  sections: Array,
  createdAt: Date
}
```

### CronJob Model
```javascript
{
  topic: String,
  language: String,
  mode: String,
  schedule: String,             // Cron expression
  isActive: Boolean,
  lastRun: Date,
  nextRun: Date,
  lastYouTubeUrl: String,
  status: String,
  errorMessage: String,
  createdAt: Date
}
```

## 🚢 Deployment on Render

### Backend Deployment

1. Create a new Web Service on [Render](https://render.com)
2. Connect your GitHub repository
3. Configure:
   - **Build Command**: `cd backend && npm install`
   - **Start Command**: `cd backend && npm start`
   - **Environment**: Add all `.env` variables

4. Important for Render:
   - Set `YOUTUBE_REDIRECT_URI` to your Render URL:
     ```
     https://your-app-name.onrender.com/api/youtube/oauth2callback
     ```
   - Update this in Google Cloud Console OAuth settings too

### Frontend Deployment

1. Create a new Static Site on Render
2. Configure:
   - **Build Command**: `cd frontend && npm run build`
   - **Publish Directory**: `frontend/.next`
   - **Environment**: Set `NEXT_PUBLIC_API_BASE` to backend URL

## 🔍 Troubleshooting

### YouTube Upload Fails

- Verify OAuth credentials are correct
- Check refresh token is valid
- Ensure YouTube Data API v3 is enabled
- Check API quota limits (10,000 units/day)

### Cron Jobs Not Running

- Check MongoDB connection
- Verify cron expressions are valid
- Check server logs for errors
- Ensure server doesn't restart (use PM2 or process manager)

### Video Generation Fails

- Check API keys (Gemini, Sarvam)
- Verify temp directory has write permissions
- Check FFmpeg/Remotion installation
- Review error logs in backend console

## 📊 API Rate Limits

- **Gemini API**: Pay-per-use (check Google Cloud billing)
- **Sarvam TTS**: Check your plan limits
- **YouTube API**: 10,000 quota units/day (1 upload = ~1600 units)
- **Unsplash API**: 50 requests/hour (demo mode)

## 🛡️ Security Notes

- Never commit `.env` files to version control
- Use environment variables for all secrets
- YouTube videos are uploaded as **unlisted** by default
- Implement authentication for production use
- Rate limit API endpoints in production

## 📝 License

MIT License - feel free to use and modify as needed.

## 🤝 Support

For issues or questions:
- Check GitHub Issues
- Review logs in backend console
- Verify all API keys are valid
- Ensure all dependencies are installed
