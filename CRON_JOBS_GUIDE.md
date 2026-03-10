# Cron Job Scheduler - User Guide

## 📅 What is the Cron Job Scheduler?

The cron job scheduler allows you to **automatically generate videos** on a schedule. Perfect for:

- Daily content creation
- Weekly educational series
- Automated posting to your YouTube channel
- Batch video generation during off-peak hours

## 🎯 Quick Start

### Create Your First Scheduled Job

1. **Access Dashboard**: Navigate to the main app at `http://localhost:3000`
2. **Find Section**: Scroll to "⏰ Scheduled Video Jobs"
3. **Click**: "+ New Job" button
4. **Fill Form**:
   - **Topic**: "Daily Science Facts"
   - **Language**: English
   - **Mode**: Generic
   - **Schedule**: "Every day at 9 AM" (preset)
5. **Submit**: Click "Create Scheduled Job"
6. **Done**: Your job is now active and will run daily at 9 AM UTC

## 📋 Schedule Options

### Presets (Easy to Use)

| Preset | Cron Expression | Description |
|--------|----------------|-------------|
| Every day at 9 AM | `0 9 * * *` | Runs once per day at 9:00 AM UTC |
| Every Monday at 10 AM | `0 10 * * 1` | Runs every Monday at 10:00 AM UTC |
| Every hour | `0 * * * *` | Runs at the start of every hour |
| Every 6 hours | `0 */6 * * *` | Runs 4 times per day (midnight, 6am, noon, 6pm) |

### Custom Cron Expressions

Select "Custom" preset and enter your own expression:

```
┌───────────── minute (0 - 59)
│ ┌───────────── hour (0 - 23)
│ │ ┌───────────── day of month (1 - 31)
│ │ │ ┌───────────── month (1 - 12)
│ │ │ │ ┌───────────── day of week (0 - 6) (0=Sunday)
│ │ │ │ │
* * * * *
```

#### Examples:

```bash
# Every 15 minutes
*/15 * * * *

# Every day at 3:30 PM
30 15 * * *

# Every weekday at 8 AM
0 8 * * 1-5

# First day of every month at midnight
0 0 1 * *

# Every Sunday at noon
0 12 * * 0

# Twice per day (9 AM and 9 PM)
0 9,21 * * *
```

**Test your cron expressions**: https://crontab.guru/

## 🎨 Job Configuration

### Topic Ideas

Choose evergreen topics that can be generated repeatedly:

**Educational Series:**
- "Science fact of the day"
- "Word of the day in Hindi"
- "Historical event on this day"
- "Math concept explained"

**Motivational Content:**
- "Daily inspiration quote explained"
- "Success story of the day"
- "Productivity tip of the week"

**News/Trends:**
- "Tech news summary"
- "Market trends explained"
- "Health tip of the day"

### Language Selection

Available languages:
- English (en-IN)
- Hindi (hi-IN)
- Bengali (bn-IN)
- Telugu (te-IN)
- Tamil (ta-IN)
- Marathi (mr-IN)
- Gujarati (gu-IN)
- Kannada (kn-IN)
- Malayalam (ml-IN)
- Odia (od-IN)
- Punjabi (pa-IN)

### Mode Selection

**Generic (Recommended for Automated Jobs)**
- Faster generation (~2-3 minutes)
- Photo slideshows with Ken Burns effects
- Lower resource usage
- More reliable for automated schedules

**Detailed (Use Sparingly)**
- Longer generation (~5-10 minutes)
- Custom animated scenes
- Higher resource usage
- Better for special content

## 🔧 Managing Jobs

### View All Jobs

All scheduled jobs appear in the "Scheduled Video Jobs" section with:
- Topic name
- Language and mode
- Cron schedule
- Last video link (if generated)
- Active/Paused status

### Pause a Job

Click the **"Active"** button to pause the job temporarily. The schedule remains saved but won't execute.

### Resume a Job

Click the **"Paused"** button to reactivate the job. It will resume on the next scheduled time.

### Delete a Job

Click the **"Delete"** button and confirm. The job and its schedule are permanently removed.

### View Last Generated Video

If a job has run successfully, click the **"📺 Last video"** link to view it on YouTube.

## 🔍 Monitoring Jobs

### Job Status Indicators

- **Pending**: Never run yet, waiting for scheduled time
- **Running**: Currently generating video
- **Completed**: Last run successful
- **Failed**: Last run encountered an error

### Error Messages

If a job fails, the error message displays below the job name:
- Check server logs for detailed error info
- Common issues: API rate limits, quota exceeded, network errors
- Failed jobs will retry on next scheduled time

## ⚙️ Advanced Usage

### API Endpoints

Programmatically manage cron jobs via REST API:

**List all jobs:**
```bash
GET http://localhost:4000/api/cron
```

**Create job:**
```bash
POST http://localhost:4000/api/cron
Content-Type: application/json

{
  "topic": "Daily AI News",
  "language": "en-IN",
  "mode": "generic",
  "schedule": "0 8 * * *",
  "isActive": true
}
```

**Toggle job:**
```bash
POST http://localhost:4000/api/cron/{jobId}/toggle
```

**Delete job:**
```bash
DELETE http://localhost:4000/api/cron/{jobId}
```

### Database Access

Jobs are stored in MongoDB `cronjobs` collection:

```javascript
{
  _id: ObjectId,
  topic: "Daily Science Facts",
  language: "en-IN",
  mode: "generic",
  schedule: "0 9 * * *",
  isActive: true,
  lastRun: Date,
  nextRun: Date,
  lastVideoId: "mongo-video-id",
  lastYouTubeUrl: "https://youtube.com/watch?v=...",
  status: "completed",
  createdAt: Date,
  updatedAt: Date
}
```

## ⚠️ Important Considerations

### Resource Planning

**Free-tier YouTube API limits:**
- 10,000 quota units per day
- ~1,600 units per upload
- **Maximum 6 videos per day**

**Example schedule limits:**
```bash
# ✅ SAFE: 1 video per day
0 9 * * *

# ✅ SAFE: 4 videos per day
0 */6 * * *

# ⚠️ WARNING: 24 videos per day (exceeds quota)
0 * * * *

# ❌ UNSAFE: 96 videos per day (way over quota)
*/15 * * * *
```

### Timing Recommendations

**Best practices:**
- Schedule during low-traffic hours (e.g., 2-6 AM UTC)
- Stagger multiple jobs with 30+ minute gaps
- Avoid overlapping generation times
- Consider server/API rate limits

**Example staggered schedule:**
```bash
Job 1: 0 3 * * *   (3:00 AM - Daily news)
Job 2: 0 4 * * *   (4:00 AM - Science fact)
Job 3: 0 5 * * *   (5:00 AM - Quote explained)
Job 4: 0 18 * * *  (6:00 PM - Evening update)
```

### Cache Behavior

**Important:** The system caches videos by topic + language hash. If you:
- Schedule same topic multiple times → Uses cached video
- Want fresh content each time → Vary the topic slightly

**Example:**
```
❌ Topic: "Science fact" (same every day, uses cache)
✅ Topic: "Science fact: [auto-incrementing]" (requires custom implementation)
✅ Topic: "Monday science fact" vs "Tuesday science fact" (different topics)
```

## 🚀 Production Deployment

### Render.com Considerations

When deploying on Render:

1. **Free tier spindown**: Your server may sleep after 15 min of inactivity
   - Cron jobs won't run while server is asleep
   - Upgrade to paid plan for 24/7 uptime

2. **Environment variables**: Ensure all cron-related env vars are set:
   ```env
   MONGODB_URI=...
   GEMINI_API_KEY=...
   SARVAM_API_KEY=...
   YOUTUBE_CLIENT_ID=...
   YOUTUBE_CLIENT_SECRET=...
   YOUTUBE_REFRESH_TOKEN=...
   ```

3. **Timezone**: Render uses UTC by default
   - All cron schedules run in UTC
   - Adjust your schedule accordingly

4. **Persistence**: Jobs persist in MongoDB
   - Server restart doesn't delete jobs
   - Jobs auto-resume on server startup

### Alternative: Use PM2

For VPS deployment, use PM2 to keep server alive:

```bash
npm install -g pm2
cd backend
pm2 start src/server.js --name ai-video-backend
pm2 save
pm2 startup
```

## 🛠️ Troubleshooting

### Jobs Not Running

**Check:**
1. Is job status "Active"? (not Paused)
2. Is server running continuously? (not sleeping)
3. Is MongoDB connection stable?
4. Check server logs for errors
5. Verify cron expression is valid

**Debug:**
```bash
# Check active cron tasks
GET /api/cron
# Review backend logs
cd backend
npm run dev  # Watch console output
```

### Jobs Fail Repeatedly

**Common causes:**
1. **YouTube quota exceeded** → Wait 24 hours or space out jobs
2. **API rate limits** → Reduce frequency or add delays
3. **Network issues** → Check server connectivity
4. **Invalid credentials** → Verify all API keys

**Solutions:**
- Reduce job frequency
- Check YouTube Studio for errors
- Review server error logs
- Test manual video generation first

### Jobs Generate Same Video

**This is by design** (caching):
- Same topic + language = same cached video
- To force new content, modify topic slightly
- Or clear cache in MongoDB

## 📊 Best Practices

1. **Start small**: Test with 1-2 jobs before scaling
2. **Monitor quota**: Track YouTube API usage daily
3. **Stagger timing**: Space jobs 30+ minutes apart
4. **Use generic mode**: Faster and more reliable for automation
5. **Meaningful topics**: Choose evergreen content that ages well
6. **Error handling**: Check job status daily, fix failed jobs
7. **Backup schedule**: Keep cron expressions documented
8. **Test first**: Manually generate before automating

## 📈 Example Use Cases

### Daily Educational Channel

```javascript
Jobs:
1. "Math problem of the day" - 0 6 * * * (6 AM daily)
2. "Science experiment explained" - 0 18 * * * (6 PM daily)

Language: English
Mode: Generic
Expected: 2 videos/day, 60 videos/month
```

### Weekly Series in Multiple Languages

```javascript
Jobs:
1. "Monday motivation in Hindi" - 0 9 * * 1
2. "Wednesday wisdom in Tamil" - 0 9 * * 3
3. "Friday facts in Bengali" - 0 9 * * 5

Language: Varies
Mode: Generic
Expected: 3 videos/week, 12 videos/month
```

### Hourly News Updates

```javascript
Job: "Tech news summary"
Schedule: 0 */4 * * * (every 4 hours)
Language: English
Mode: Generic
Expected: 6 videos/day, 180 videos/month
Warning: High quota usage!
```

---

**Questions?** Check README.md or review backend logs for detailed error messages.
