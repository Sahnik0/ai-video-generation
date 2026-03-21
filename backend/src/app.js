const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const videosRouter = require("./routes/videos");
const cronRouter = require("./routes/cron");
const youtubeRouter = require("./routes/youtube");
const youtubeVideoRouter = require("./routes/youtubeVideo");

const app = express();

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }
  })
);
app.use(cors({ origin: true }));
app.use(express.json({ limit: "2mb" }));

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// Lightweight ping endpoint for uptime monitors / keep-alive pings
app.get("/ping", (req, res) => {
  res.status(200).json({ status: "ok", uptime: process.uptime() });
});

app.use("/api/videos", videosRouter);
app.use("/api/cron", cronRouter);
app.use("/api/youtube", youtubeRouter);
app.use("/api/youtube-video", youtubeVideoRouter);

module.exports = { app };
