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
  sarvamApiKey: requireEnv("SARVAM_API_KEY")
};

module.exports = { env };
