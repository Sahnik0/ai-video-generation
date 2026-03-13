const express = require("express");
const { listVideos } = require("../controllers/videoController");

const router = express.Router();

router.get("/", listVideos);

module.exports = router;
