const express = require("express");
const { generateVideo, listVideos } = require("../controllers/videoController");
const { generateDetailedVideo } = require("../controllers/detailedVideoController");

const router = express.Router();

router.get("/", listVideos);
router.post("/generate", generateVideo);
router.post("/generate-detailed", generateDetailedVideo);

module.exports = router;
