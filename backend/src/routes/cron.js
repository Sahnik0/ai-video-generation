/**
 * routes/cron.js
 * 
 * API routes for cron job management
 */

const express = require("express");
const {
  listCronJobs,
  getCronJob,
  createCronJob,
  updateCronJob,
  deleteCronJob,
  toggleCronJob,
  deleteCompletedCronJobs
} = require("../controllers/cronController");

const router = express.Router();

router.get("/", listCronJobs);
router.delete("/completed/all", deleteCompletedCronJobs);
router.get("/:id", getCronJob);
router.post("/", createCronJob);
router.put("/:id", updateCronJob);
router.delete("/:id", deleteCronJob);
router.post("/:id/toggle", toggleCronJob);

module.exports = router;
