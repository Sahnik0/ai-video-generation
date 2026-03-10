"use client";

import { useState, useEffect } from "react";

type CronJob = {
  _id: string;
  topic: string;
  language: string;
  mode: "generic" | "detailed";
  schedule: string;
  isActive: boolean;
  lastRun?: string;
  nextRun?: string;
  lastYouTubeUrl?: string;
  status: "pending" | "running" | "completed" | "failed";
  errorMessage?: string;
};

type CronJobManagerProps = {
  apiBase: string;
  addNotification: (message: string, type: "success" | "error" | "info" | "warning") => void;
};

const SUPPORTED_LANGUAGES = [
  { code: "en-IN", label: "English" },
  { code: "hi-IN", label: "Hindi" },
  { code: "bn-IN", label: "Bengali" },
  { code: "te-IN", label: "Telugu" },
  { code: "ta-IN", label: "Tamil" },
  { code: "mr-IN", label: "Marathi" },
  { code: "gu-IN", label: "Gujarati" },
  { code: "kn-IN", label: "Kannada" },
  { code: "ml-IN", label: "Malayalam" },
  { code: "od-IN", label: "Odia" },
  { code: "pa-IN", label: "Punjabi" },
];

const CRON_PRESETS = [
  { label: "Every day at 9 AM", value: "0 9 * * *" },
  { label: "Every Monday at 10 AM", value: "0 10 * * 1" },
  { label: "Every hour", value: "0 * * * *" },
  { label: "Every 6 hours", value: "0 */6 * * *" },
  { label: "Custom", value: "" },
];

export function CronJobManager({ apiBase, addNotification }: CronJobManagerProps) {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [loading, setLoading] = useState(false);

  // Form state
  const [newTopic, setNewTopic] = useState("");
  const [newLanguage, setNewLanguage] = useState("en-IN");
  const [newMode, setNewMode] = useState<"generic" | "detailed">("generic");
  const [selectedPreset, setSelectedPreset] = useState("0 9 * * *");
  const [customSchedule, setCustomSchedule] = useState("");

  const loadJobs = async () => {
    try {
      const response = await fetch(`${apiBase}/api/cron`);
      const data = await response.json();
      if (data.success) {
        setJobs(data.jobs);
      }
    } catch (error) {
      console.error("Failed to load cron jobs:", error);
      addNotification("Failed to load scheduled jobs", "error");
    }
  };

  useEffect(() => {
    loadJobs();
  }, []);

  const handleCreate = async () => {
    if (!newTopic.trim()) {
      addNotification("Please enter a topic", "warning");
      return;
    }

    const schedule = selectedPreset || customSchedule;
    if (!schedule) {
      addNotification("Please select or enter a schedule", "warning");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${apiBase}/api/cron`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: newTopic,
          language: newLanguage,
          mode: newMode,
          schedule,
          isActive: true,
        }),
      });

      const data = await response.json();
      if (response.ok && data.success) {
        addNotification("Cron job created successfully!", "success");
        setNewTopic("");
        setShowCreateForm(false);
        await loadJobs();
      } else {
        throw new Error(data.error || "Failed to create cron job");
      }
    } catch (error) {
      addNotification(error instanceof Error ? error.message : "Failed to create job", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = async (jobId: string) => {
    try {
      const response = await fetch(`${apiBase}/api/cron/${jobId}/toggle`, {
        method: "POST",
      });

      const data = await response.json();
      if (response.ok && data.success) {
        addNotification(`Job ${data.job.isActive ? "activated" : "deactivated"}`, "success");
        await loadJobs();
      } else {
        throw new Error(data.error || "Failed to toggle job");
      }
    } catch (error) {
      addNotification(error instanceof Error ? error.message : "Failed to toggle job", "error");
    }
  };

  const handleDelete = async (jobId: string) => {
    if (!confirm("Are you sure you want to delete this cron job?")) return;

    try {
      const response = await fetch(`${apiBase}/api/cron/${jobId}`, {
        method: "DELETE",
      });

      const data = await response.json();
      if (response.ok && data.success) {
        addNotification("Cron job deleted", "success");
        await loadJobs();
      } else {
        throw new Error(data.error || "Failed to delete job");
      }
    } catch (error) {
      addNotification(error instanceof Error ? error.message : "Failed to delete job", "error");
    }
  };

  return (
    <div className="card p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Scheduled Jobs</h2>
          <p className="text-sm text-muted-foreground mt-1">Automate video generation on schedule</p>
        </div>
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="btn btn-primary px-4 h-9 text-sm"
        >
          {showCreateForm ? "Cancel" : "New Job"}
        </button>
      </div>

      {showCreateForm && (
        <div className="p-4 space-y-4 rounded-lg bg-slate-50 dark:bg-slate-800/30 border border-border">
          <input
            type="text"
            className="input"
            placeholder="Video topic..."
            value={newTopic}
            onChange={(e) => setNewTopic(e.target.value)}
          />

          <div className="grid grid-cols-2 gap-4">
            <select
              className="input"
              value={newLanguage}
              onChange={(e) => setNewLanguage(e.target.value)}
            >
              {SUPPORTED_LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.label}
                </option>
              ))}
            </select>

            <select
              className="input"
              value={newMode}
              onChange={(e) => setNewMode(e.target.value as "generic" | "detailed")}
            >
              <option value="generic">Generic</option>
              <option value="detailed">Detailed</option>
            </select>
          </div>

          <select
            className="input"
            value={selectedPreset}
            onChange={(e) => setSelectedPreset(e.target.value)}
          >
            {CRON_PRESETS.map((preset) => (
              <option key={preset.label} value={preset.value}>
                {preset.label}
              </option>
            ))}
          </select>

          {!selectedPreset && (
            <input
              type="text"
              className="input"
              placeholder="Custom cron expression (e.g., 0 9 * * *)"
              value={customSchedule}
              onChange={(e) => setCustomSchedule(e.target.value)}
            />
          )}

          <button
            onClick={handleCreate}
            disabled={loading}
            className="btn btn-primary w-full h-10 disabled:opacity-50"
          >
            {loading ? "Creating..." : "Create Job"}
          </button>
        </div>
      )}

      <div className="space-y-3">
        {jobs.length === 0 ? (
          <p className="text-center text-muted-foreground py-8 text-sm">No scheduled jobs yet. Create one to automate video generation.</p>
        ) : (
          jobs.map((job) => (
            <div
              key={job._id}
              className={`card p-4 ${!job.isActive ? "opacity-60" : ""}`}
            >
              <div className="flex justify-between items-start gap-4">
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-foreground truncate">{job.topic}</h3>
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    <span className="badge badge-primary">{job.language}</span>
                    <span className="badge badge-primary">{job.mode}</span>
                    <span className="text-xs text-muted-foreground">{job.schedule}</span>
                  </div>
                  {job.lastYouTubeUrl && (
                    <a
                      href={job.lastYouTubeUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary hover:underline mt-2 inline-block"
                    >
                      View last video →
                    </a>
                  )}
                  {job.status === "failed" && job.errorMessage && (
                    <p className="text-xs text-red-600 dark:text-red-400 mt-2">
                      Error: {job.errorMessage}
                    </p>
                  )}
                </div>

                <div className="flex gap-2 flex-shrink-0">
                  <button
                    onClick={() => handleToggle(job._id)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                      job.isActive
                        ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                        : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400"
                    }`}
                  >
                    {job.isActive ? "Active" : "Paused"}
                  </button>
                  <button
                    onClick={() => handleDelete(job._id)}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
