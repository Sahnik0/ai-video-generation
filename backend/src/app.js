const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const videosRouter = require("./routes/videos");
const cronRouter = require("./routes/cron");
const youtubeRouter = require("./routes/youtube");

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

app.use("/api/videos", videosRouter);
app.use("/api/cron", cronRouter);
app.use("/api/youtube", youtubeRouter);

module.exports = { app };
