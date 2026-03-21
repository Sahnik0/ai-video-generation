"use client";

import { useState, useRef, useEffect } from "react";

type UploadTarget = "s3";

type JobStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed";

type JobResponse = {
  jobId: string;
  status: JobStatus;
  step: string;
  progress: number;
  message: string;
  result: { videoUrl: string; title: string; videoId: string } | null;
  error: string | null;
};

type YouTubeVideoFormProps = {
  apiBase: string;
  addNotification: (message: string, type: "success" | "error" | "info" | "warning") => void;
  onVideoReady?: (video: { videoUrl: string; title: string; videoId: string }) => void;
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

const PIPELINE_STEPS = [
  { key: "downloading",       label: "Downloading Audio",      icon: "⬇️" },
  { key: "organizing",        label: "Organizing Script",       icon: "🧠" },
  { key: "generating_audio",  label: "Generating Voiceover",   icon: "🎙️" },
  { key: "generating_scenes", label: "Designing Animations",   icon: "🎬" },
  { key: "rendering",         label: "Rendering Video",        icon: "🖥️" },
  { key: "uploading",         label: "Uploading",              icon: "☁️" },
  { key: "done",              label: "Complete",               icon: "✅" },
];

function isValidYouTubeUrl(url: string): boolean {
  return /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/.test(url);
}

export function YouTubeVideoForm({
  apiBase,
  addNotification,
  onVideoReady,
}: YouTubeVideoFormProps) {
  const [url, setUrl] = useState("");
  const [language, setLanguage] = useState("en-IN");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobState, setJobState] = useState<JobResponse | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);

  const urlValid = url ? isValidYouTubeUrl(url) : true;

  // Stop polling when job is done or failed
  useEffect(() => {
    if (!jobId) return;

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${apiBase}/api/youtube-video/status/${jobId}`);
        const data: JobResponse = await res.json();
        setJobState(data);

        if (data.status === "completed") {
          clearInterval(pollRef.current!);
          addNotification("🎉 Video generated successfully!", "success");
          if (data.result && onVideoReady) {
            onVideoReady(data.result);
          }
        } else if (data.status === "failed") {
          clearInterval(pollRef.current!);
          addNotification(`Generation failed: ${data.error || "Unknown error"}`, "error");
        }
      } catch {
        // Swallow transient network errors
      }
    }, 3000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [jobId]);

  const handleSubmit = async () => {
    if (!url.trim() || !isValidYouTubeUrl(url)) {
      addNotification("Please enter a valid YouTube URL", "warning");
      urlInputRef.current?.focus();
      return;
    }

    setIsSubmitting(true);
    setJobId(null);
    setJobState(null);

    try {
      const res = await fetch(`${apiBase}/api/youtube-video`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ youtubeUrl: url, language, uploadTarget: "s3" }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to start generation");
      }

      setJobId(data.jobId);
      addNotification("Pipeline started! Sit back and relax ☕", "info");
    } catch (err) {
      addNotification(err instanceof Error ? err.message : "Failed to start", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    setJobId(null);
    setJobState(null);
    setUrl("");
  };

  const currentStepIndex = jobState
    ? PIPELINE_STEPS.findIndex((s) => s.key === jobState.step)
    : -1;

  const isActive = !!jobId && jobState?.status !== "completed" && jobState?.status !== "failed";
  const isDone = jobState?.status === "completed";
  const isFailed = jobState?.status === "failed";

  return (
    <div className="card p-6 space-y-6 animate-fade-up">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <span>🎥</span> YouTube to Animated Video
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Paste a YouTube lecture URL — we&apos;ll extract the audio, organize the script with AI,
          and generate a fully animated educational video.
        </p>
      </div>

      {/* Input form (hide when job is running / done) */}
      {!jobId && (
        <div className="space-y-4">
          {/* URL input */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              YouTube Video URL
            </label>
            <input
              ref={urlInputRef}
              type="url"
              className={`input w-full ${!urlValid ? "border-red-500 focus:ring-red-500" : ""}`}
              placeholder="https://www.youtube.com/watch?v=..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            />
            {!urlValid && (
              <p className="text-xs text-red-500 mt-1">
                That doesn&apos;t look like a valid YouTube URL.
              </p>
            )}
            <p className="text-xs text-muted-foreground mt-1.5">
              Works with any educational lecture, tutorial, or explainer video (up to ~30 min).
            </p>
          </div>

          {/* Language */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Output Language
            </label>
            <select
              className="input w-full"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
            >
              {SUPPORTED_LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground mt-1.5">
              The generated voiceover and video will be in this language.
            </p>
          </div>

          {/* Upload target note */}
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-secondary/70 border border-border">
            <span className="text-sm">☁️</span>
            <p className="text-xs text-muted-foreground">
              Video will be uploaded to <strong>S3</strong> and appear in your Video Library when ready.
            </p>
          </div>

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={isSubmitting || !url.trim() || !urlValid}
            className="btn btn-primary w-full h-11 disabled:opacity-50 text-sm font-medium"
          >
            {isSubmitting ? (
              <span className="flex items-center justify-center gap-2">
                <span className="animate-spin">⟳</span> Starting pipeline...
              </span>
            ) : (
              "Generate Animated Video"
            )}
          </button>
        </div>
      )}

      {/* Progress tracker */}
      {jobId && (
        <div className="space-y-5">
          {/* Overall progress bar */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-medium text-foreground">
                {isDone
                  ? "Video Ready!"
                  : isFailed
                  ? "Generation Failed"
                  : "Generating..."}
              </span>
              <span
                className={`text-sm font-semibold ${
                  isDone
                    ? "text-green-500"
                    : isFailed
                    ? "text-red-500"
                    : "text-primary"
                }`}
              >
                {jobState?.progress ?? 0}%
              </span>
            </div>
            <div className="w-full h-2.5 bg-secondary rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ease-out ${
                  isDone
                    ? "bg-green-500"
                    : isFailed
                    ? "bg-red-500"
                    : "bg-primary"
                }`}
                style={{ width: `${jobState?.progress ?? 0}%` }}
              />
            </div>
            {/* Current message */}
            <p className="text-xs text-muted-foreground mt-1.5">
              {jobState?.message || "Initializing..."}
            </p>
          </div>

          {/* Step-by-step tracker */}
          <div className="space-y-1.5">
            {PIPELINE_STEPS.map((step, idx) => {
              const isCompleted = currentStepIndex > idx || isDone;
              const isCurrent = currentStepIndex === idx && isActive;
              const isFutureStep = currentStepIndex < idx && !isDone;

              return (
                <div
                  key={step.key}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all duration-300 ${
                    isCompleted
                      ? "bg-green-50 dark:bg-green-900/10 text-green-700 dark:text-green-400"
                      : isCurrent
                      ? "bg-primary/10 text-primary border border-primary/30"
                      : "text-muted-foreground"
                  }`}
                >
                  <span className="text-base">
                    {isCompleted ? "✓" : isCurrent ? <span className="animate-pulse">{step.icon}</span> : step.icon}
                  </span>
                  <span className={`font-medium ${isCurrent ? "font-semibold" : ""}`}>
                    {step.label}
                  </span>
                  {isCurrent && (
                    <span className="ml-auto text-xs text-primary animate-pulse">In progress...</span>
                  )}
                  {isCompleted && !isFutureStep && (
                    <span className="ml-auto text-xs text-green-600 dark:text-green-400">Done</span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Error state */}
          {isFailed && (
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
              <p className="text-sm text-red-700 dark:text-red-400 font-medium">Error:</p>
              <p className="text-xs text-red-600 dark:text-red-500 mt-0.5">
                {jobState?.error || "Unknown error occurred"}
              </p>
            </div>
          )}

          {/* Success result */}
          {isDone && jobState?.result && (
            <div className="p-4 rounded-lg bg-green-50 dark:bg-green-900/10 border border-green-200 dark:border-green-700 space-y-2">
              <p className="text-sm font-semibold text-green-700 dark:text-green-400">
                🎉 {jobState.result.title}
              </p>
              <a
                href={jobState.result.videoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-primary hover:underline inline-block"
              >
                Open video →
              </a>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-2">
            {isDone || isFailed ? (
              <button
                onClick={handleReset}
                className="btn btn-primary w-full h-9 text-sm"
              >
                Generate Another Video
              </button>
            ) : (
              <p className="text-xs text-muted-foreground text-center w-full pt-1">
                This typically takes 5–15 minutes depending on video length.
                You can safely leave this page and come back.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
