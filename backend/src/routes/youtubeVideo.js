/**
 * routes/youtubeVideo.js
 *
 * API routes for the "Fetch from YouTube" video generation feature.
 */

const express = require("express");
const {
  createYouTubeVideo,
  getYouTubeVideoStatus,
} = require("../controllers/youtubeVideoController");

const router = express.Router();

// POST /api/youtube-video — kick off a new YouTube → video generation job
router.post("/", createYouTubeVideo);

// GET /api/youtube-video/status/:jobId — poll job progress
router.get("/status/:jobId", getYouTubeVideoStatus);

module.exports = router;
