/**
 * youtubeService.js
 * 
 * Handles YouTube video uploads using OAuth2 authentication.
 * Videos are uploaded as UNLISTED by default.
 */

const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");
const { env } = require("../config/env");

const OAuth2 = google.auth.OAuth2;

/**
 * Create an OAuth2 client with credentials
 */
const createOAuth2Client = () => {
  return new OAuth2(
    env.youtube.clientId,
    env.youtube.clientSecret,
    env.youtube.redirectUri
  );
};

/**
 * Get authenticated YouTube client
 */
const getAuthenticatedClient = () => {
  const oauth2Client = createOAuth2Client();
  
  if (!env.youtube.refreshToken) {
    throw new Error("YouTube refresh token not configured. Please complete OAuth flow first.");
  }
  
  oauth2Client.setCredentials({
    refresh_token: env.youtube.refreshToken
  });
  
  return google.youtube({ version: "v3", auth: oauth2Client });
};

/**
 * Generate OAuth URL for first-time authentication
 */
const getAuthUrl = () => {
  const oauth2Client = createOAuth2Client();
  
  const scopes = [
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube"
  ];
  
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: scopes,
    prompt: "consent"
  });
};

/**
 * Exchange authorization code for tokens
 */
const getTokensFromCode = async (code) => {
  const oauth2Client = createOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
};

/**
 * Upload video to YouTube
 * 
 * @param {string} videoPath - Path to the video file
 * @param {Object} metadata - Video metadata
 * @param {string} metadata.title - Video title
 * @param {string} metadata.description - Video description
 * @param {string[]} metadata.tags - Video tags
 * @param {string} metadata.categoryId - YouTube category ID (default: 27 for Education)
 * @param {string} metadata.privacyStatus - "private" | "unlisted" | "public" (default: "unlisted")
 * @returns {Promise<Object>} YouTube video data including video ID and URL
 */
const uploadToYouTube = async (videoPath, metadata = {}) => {
  try {
    console.log(`[youtube] starting upload: ${path.basename(videoPath)}`);
    
    const youtube = getAuthenticatedClient();
    
    const {
      title = "Untitled Video",
      description = "",
      tags = [],
      categoryId = "27", // Education
      privacyStatus = "unlisted"
    } = metadata;
    
    const fileSize = fs.statSync(videoPath).size;
    console.log(`[youtube] file size: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);
    
    const response = await youtube.videos.insert({
      part: "snippet,status",
      requestBody: {
        snippet: {
          title,
          description,
          tags,
          categoryId
        },
        status: {
          privacyStatus,
          selfDeclaredMadeForKids: false
        }
      },
      media: {
        body: fs.createReadStream(videoPath)
      }
    });
    
    const videoId = response.data.id;
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    
    console.log(`[youtube] upload successful! Video ID: ${videoId}`);
    console.log(`[youtube] video URL: ${videoUrl}`);
    
    return {
      videoId,
      videoUrl,
      title: response.data.snippet.title,
      status: response.data.status.privacyStatus,
      publishedAt: response.data.snippet.publishedAt
    };
  } catch (error) {
    console.error("[youtube] upload failed:", error.message);
    if (error.errors) {
      console.error("[youtube] error details:", JSON.stringify(error.errors, null, 2));
    }
    throw new Error(`YouTube upload failed: ${error.message}`);
  }
};

/**
 * Delete uploaded video from YouTube (optional cleanup)
 */
const deleteFromYouTube = async (videoId) => {
  try {
    const youtube = getAuthenticatedClient();
    await youtube.videos.delete({ id: videoId });
    console.log(`[youtube] video ${videoId} deleted`);
    return true;
  } catch (error) {
    console.error(`[youtube] failed to delete video ${videoId}:`, error.message);
    return false;
  }
};

/**
 * Update video metadata on YouTube
 */
const updateVideoMetadata = async (videoId, updates = {}) => {
  try {
    const youtube = getAuthenticatedClient();
    
    const response = await youtube.videos.update({
      part: "snippet,status",
      requestBody: {
        id: videoId,
        snippet: updates.snippet || {},
        status: updates.status || {}
      }
    });
    
    console.log(`[youtube] video ${videoId} metadata updated`);
    return response.data;
  } catch (error) {
    console.error(`[youtube] failed to update video ${videoId}:`, error.message);
    throw error;
  }
};

module.exports = {
  uploadToYouTube,
  deleteFromYouTube,
  updateVideoMetadata,
  getAuthUrl,
  getTokensFromCode,
  getAuthenticatedClient
};
