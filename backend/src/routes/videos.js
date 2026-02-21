const express = require("express");
const { generateVideo, listVideos } = require("../controllers/videoController");

const router = express.Router();

router.get("/", listVideos);
router.post("/generate", generateVideo);

module.exports = router;
