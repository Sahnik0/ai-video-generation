const dotenv = require("dotenv");

dotenv.config();

const requireEnv = (key) => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value;
};

const env = {
  port: process.env.PORT || 4000,
  mongoUri: requireEnv("MONGODB_URI"),
  geminiApiKey: requireEnv("GEMINI_API_KEY"),
  sarvamApiKey: requireEnv("SARVAM_API_KEY"),
  youtube: {
    clientId: process.env.YOUTUBE_CLIENT_ID || "",
    clientSecret: process.env.YOUTUBE_CLIENT_SECRET || "",
    redirectUri: process.env.YOUTUBE_REDIRECT_URI || "http://localhost:4000/api/youtube/oauth2callback",
    refreshToken: process.env.YOUTUBE_REFRESH_TOKEN || ""
  }
};

module.exports = { env };
