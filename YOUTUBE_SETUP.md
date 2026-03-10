# YouTube OAuth Setup - Quick Start Guide

## 🎯 Quick Setup (5 minutes)

### 1. Google Cloud Console Setup

1. **Visit**: https://console.cloud.google.com/
2. **Create/Select** a project
3. **Enable API**:
   - Navigate to: APIs & Services → Library
   - Search: "YouTube Data API v3"
   - Click: Enable

### 2. Create OAuth Credentials

1. Go to: **APIs & Services → Credentials**
2. Click: **Create Credentials → OAuth client ID**
3. Application type: **Web application**
4. Name: `AI Video Generator YouTube`
5. **Authorized redirect URIs**:
   ```
   http://localhost:4000/api/youtube/oauth2callback
   ```
   
   **For Production (Render)**:
   ```
   https://your-app-name.onrender.com/api/youtube/oauth2callback
   ```

6. Click: **Create**
7. **Copy** Client ID and Client Secret

### 3. Update .env File

```env
YOUTUBE_CLIENT_ID=your-client-id-here.apps.googleusercontent.com
YOUTUBE_CLIENT_SECRET=your-client-secret-here
YOUTUBE_REDIRECT_URI=http://localhost:4000/api/youtube/oauth2callback
```

### 4. Get Refresh Token

1. **Start backend**:
   ```bash
   cd backend
   npm run dev
   ```

2. **Visit** the OAuth URL in console output, or:
   ```
   http://localhost:4000/api/youtube/auth
   ```

3. **Click** the authorization link

4. **Sign in** with your Google account (the one you want to upload videos to)

5. **Grant permissions** - Click "Allow"

6. **Copy** the refresh token from the callback page

7. **Add to .env**:
   ```env
   YOUTUBE_REFRESH_TOKEN=1//your-long-refresh-token-here
   ```

8. **Restart** the backend server

### 5. Test Video Upload

1. Visit: `http://localhost:3000`
2. Enter a topic and generate a video
3. Video will upload to YouTube as **unlisted**
4. Check your YouTube Studio to see the uploaded video

## 🔧 Troubleshooting

### "YouTube refresh token not configured" error
- Make sure you completed step 4 above
- Ensure the refresh token is in `.env` and server was restarted

### "Invalid credentials" error
- Verify Client ID and Client Secret are correct
- Check for extra spaces in `.env` file
- Ensure you're using the correct Google account

### Upload fails with quota error
- YouTube API has daily limit (10,000 quota units)
- Each upload uses ~1,600 units
- Max ~6 uploads per day on free tier
- Request quota increase in Google Cloud Console

### Redirect URI mismatch
- Ensure redirect URI in `.env` matches exactly what's in Google Cloud Console
- Include the full URL with protocol (http:// or https://)
- For localhost use `http://`, for production use `https://`

## 📋 Testing Checklist

- [ ] Google Cloud project created
- [ ] YouTube Data API v3 enabled
- [ ] OAuth client ID created
- [ ] Redirect URI configured
- [ ] Client ID and Secret in `.env`
- [ ] Refresh token obtained and added to `.env`
- [ ] Backend server restarted
- [ ] Test video generated successfully
- [ ] Video appears in YouTube Studio as unlisted

## 🚀 Production Deployment (Render)

When deploying to Render:

1. **Update Google Cloud Console**:
   - Add your Render URL to authorized redirect URIs:
     ```
     https://your-app-name.onrender.com/api/youtube/oauth2callback
     ```

2. **Update Render Environment Variables**:
   ```env
   YOUTUBE_REDIRECT_URI=https://your-app-name.onrender.com/api/youtube/oauth2callback
   ```

3. **Re-authorize** (get new refresh token):
   - Visit: `https://your-app-name.onrender.com/api/youtube/auth`
   - Complete OAuth flow again
   - Update `YOUTUBE_REFRESH_TOKEN` in Render environment

## ⚠️ Important Notes

- **Refresh tokens don't expire** unless you revoke access
- **Keep refresh token secret** - it provides YouTube upload access
- **Videos are unlisted** by default (not public)
- **Backup your refresh token** in a secure location
- **One refresh token per Google account** - re-authorization overwrites previous token

## 📊 Understanding YouTube Quotas

- **Free tier**: 10,000 quota units per day
- **Upload cost**: ~1,600 units per video
- **Max uploads**: ~6 videos per day
- **Reset time**: Midnight Pacific Time (PT)

To check your quota usage:
1. Go to Google Cloud Console
2. Navigate to: APIs & Services → Dashboard
3. Click on: YouTube Data API v3
4. View: Quota usage charts

## 🔐 Security Best Practices

1. **Never commit `.env`** to version control
2. **Use different credentials** for development and production
3. **Rotate credentials** if exposed
4. **Monitor quota usage** to detect unusual activity
5. **Restrict API keys** by IP or referrer if possible

---

Need help? Check the main README.md or review backend server logs for detailed error messages.
