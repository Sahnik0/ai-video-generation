/**
 * routes/youtube.js
 * 
 * YouTube OAuth and authentication routes
 */

const express = require("express");
const { getAuthUrl, getTokensFromCode } = require("../services/youtubeService");

const router = express.Router();

/**
 * GET /api/youtube/auth - Get OAuth URL for authorization
 */
router.get("/auth", (req, res) => {
  try {
    const authUrl = getAuthUrl();
    res.json({ authUrl });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/youtube/oauth2callback - OAuth callback endpoint
 */
router.get("/oauth2callback", async (req, res) => {
  try {
    const { code } = req.query;
    
    if (!code) {
      return res.status(400).send("Authorization code missing");
    }
    
    const tokens = await getTokensFromCode(code);
    
    // Display the refresh token (user needs to add this to .env)
    res.send(`
      <html>
        <body>
          <h1>YouTube Authorization Successful!</h1>
          <p>Copy this refresh token to your .env file:</p>
          <pre style="background: #f4f4f4; padding: 10px; border-radius: 5px;">
YOUTUBE_REFRESH_TOKEN=${tokens.refresh_token}
          </pre>
          <p>Restart your server after updating .env</p>
        </body>
      </html>
    `);
  } catch (error) {
    res.status(500).send(`Error: ${error.message}`);
  }
});

module.exports = router;
