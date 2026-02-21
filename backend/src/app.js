const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const path = require("path");
const videosRouter = require("./routes/videos");

const app = express();

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }
  })
);
app.use(cors({ origin: true }));
app.use(express.json({ limit: "2mb" }));

const videoPath = path.resolve(__dirname, "../storage/videos");
app.use("/videos", express.static(videoPath));

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/videos", videosRouter);

module.exports = { app };
