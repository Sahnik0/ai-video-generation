"use client";

import { useEffect, useState, useRef } from "react";
import { Notification } from "../components/Notification";
import { ThemeToggle } from "../components/ThemeToggle";
import { CronJobManager } from "../components/CronJobManager";

type VideoItem = {
  id: string;
  title: string;
  topic: string;
  createdAt: string;
  videoUrl: string | null;
  youtubeVideoId?: string;
  mode?: "generic" | "detailed";
};

type NotificationType = {
  id: number;
  message: string;
  type: "success" | "error" | "info" | "warning";
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

export default function Home() {
  const [topic, setTopic] = useState("");
  const [selectedLanguage, setSelectedLanguage] = useState("en-IN");
  const [selectedMode, setSelectedMode] = useState<"generic" | "detailed">("generic");
  const [isLoading, setIsLoading] = useState(false);
  const [currentVideo, setCurrentVideo] = useState<VideoItem | null>(null);
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<NotificationType[]>([]);
  const [currentStep, setCurrentStep] = useState(0);
  const videoRef = useRef<HTMLDivElement>(null);

  const apiBase = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:4000";

  const steps = [
    "Analyzing topic with AI",
    "Processing content",
    "Generating narration",
    "Uploading to YouTube"
  ];

  const getYouTubeVideoId = (url: string): string | null => {
    const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/);
    return match ? match[1] : null;
  };

  const addNotification = (message: string, type: NotificationType["type"]) => {
    const id = Date.now();
    setNotifications((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setNotifications((prev) => prev.filter((notif) => notif.id !== id));
    }, 5000);
  };

  const loadVideos = async () => {
    try {
      const response = await fetch(`${apiBase}/api/videos`);
      const data = await response.json();
      setVideos(data.items || []);
    } catch (err) {
      console.error("Failed to load videos:", err);
    }
  };

  useEffect(() => {
    loadVideos();
  }, []);

  useEffect(() => {
    if (isLoading) {
      const interval = setInterval(() => {
        setCurrentStep((prev) => (prev < steps.length - 1 ? prev + 1 : prev));
      }, 2500);
      return () => clearInterval(interval);
    } else {
      setCurrentStep(0);
    }
  }, [isLoading]);

  const handleGenerate = async () => {
    if (!topic.trim()) {
      addNotification("Please enter a topic", "warning");
      return;
    }

    setError(null);
    setCurrentVideo(null);
    setIsLoading(true);
    setCurrentStep(0);

    try {
      const endpoint = selectedMode === "detailed"
        ? `${apiBase}/api/videos/generate-detailed`
        : `${apiBase}/api/videos/generate`;

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, language: selectedLanguage })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to generate video");
      }

      setCurrentVideo({
        id: data.videoId || "latest",
        title: data.title,
        topic: data.topic,
        createdAt: new Date().toISOString(),
        videoUrl: data.videoUrl,
        youtubeVideoId: data.youtubeVideoId
      });

      await loadVideos();
      addNotification("Video generated successfully", "success");
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Something went wrong";
      setError(errorMessage);
      addNotification(errorMessage, "error");
    } finally {
      setIsLoading(false);
    }
  };

  const handleVideoSelect = (video: VideoItem) => {
    setCurrentVideo(video);
    videoRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      {/* Notifications */}
      <div className="fixed top-4 right-4 z-50 space-y-2">
        {notifications.map((notification) => (
          <Notification
            key={notification.id}
            message={notification.message}
            type={notification.type}
            onClose={() =>
              setNotifications((prev) => prev.filter((n) => n.id !== notification.id))
            }
          />
        ))}
      </div>

      {/* Header */}
      <header className="border-b border-border/40 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">AI Video Studio</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Generate professional videos with AI</p>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* Main Generator Section */}
        <div className="grid lg:grid-cols-3 gap-6">
          {/* Input Panel */}
          <div className="lg:col-span-2 space-y-6">
            <div className="card p-6 space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Create Video</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Enter a topic and configure your video settings
                </p>
              </div>

              <div className="space-y-4">
                {/* Topic Input */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Video Topic
                  </label>
                  <textarea
                    className="input min-h-[120px] resize-none"
                    placeholder="e.g., The future of renewable energy, How AI is changing education..."
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                  />
                </div>

                {/* Language and Mode */}
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-2">
                      Language
                    </label>
                    <select
                      className="input cursor-pointer"
                      value={selectedLanguage}
                      onChange={(e) => setSelectedLanguage(e.target.value)}
                    >
                      {SUPPORTED_LANGUAGES.map((lang) => (
                        <option key={lang.code} value={lang.code}>
                          {lang.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-foreground mb-2">
                      Generation Mode
                    </label>
                    <select
                      className="input cursor-pointer"
                      value={selectedMode}
                      onChange={(e) => setSelectedMode(e.target.value as "generic" | "detailed")}
                    >
                      <option value="generic">Generic - Fast slideshow</option>
                      <option value="detailed">Detailed - Animated scenes</option>
                    </select>
                  </div>
                </div>

                {/* Generate Button */}
                <button
                  onClick={handleGenerate}
                  disabled={isLoading}
                  className="btn btn-primary w-full h-12 text-base font-medium disabled:opacity-50"
                >
                  {isLoading ? (
                    <span className="flex items-center gap-2">
                      <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Generating...
                    </span>
                  ) : (
                    "Generate Video"
                  )}
                </button>

                {error && (
                  <div className="p-4 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/50">
                    <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Progress/Result */}
            {isLoading && (
              <div className="card p-6">
                <h3 className="text-lg font-semibold text-foreground mb-4">Processing</h3>
                <div className="space-y-3">
                  {steps.map((step, index) => (
                    <div key={index} className="flex items-center gap-3">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                        index < currentStep
                          ? "bg-green-500 text-white"
                          : index === currentStep
                          ? "bg-primary text-white"
                          : "bg-slate-200 dark:bg-slate-700 text-slate-500"
                      }`}>
                        {index < currentStep ? "✓" : index + 1}
                      </div>
                      <span className={`text-sm ${
                        index <= currentStep
                          ? "text-foreground font-medium"
                          : "text-muted-foreground"
                      }`}>
                        {step}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {currentVideo && currentVideo.videoUrl && !isLoading && (
              <div className="card p-6 space-y-4" ref={videoRef}>
                <div>
                  <h3 className="text-lg font-semibold text-foreground">{currentVideo.title}</h3>
                  <p className="text-sm text-muted-foreground mt-1">Generated video ready</p>
                </div>
                
                <div className="aspect-video bg-black rounded-lg overflow-hidden">
                  {currentVideo.videoUrl.includes("youtube.com") || currentVideo.videoUrl.includes("youtu.be") ? (
                    <iframe
                      width="100%"
                      height="100%"
                      src={`https://www.youtube.com/embed/${getYouTubeVideoId(currentVideo.videoUrl)}`}
                      title="Video player"
                      frameBorder="0"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                    ></iframe>
                  ) : (
                    <video controls className="w-full h-full">
                      <source src={currentVideo.videoUrl} type="video/mp4" />
                    </video>
                  )}
                </div>

                <div className="flex gap-3">
                  <a
                    href={currentVideo.videoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-primary px-6 h-10"
                  >
                    Watch on YouTube
                  </a>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(currentVideo.videoUrl || "");
                      addNotification("Link copied", "success");
                    }}
                    className="btn btn-secondary px-6 h-10"
                  >
                    Copy Link
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Sidebar - Stats */}
          <div className="space-y-6">
            <div className="card p-6">
              <h3 className="text-sm font-semibold text-foreground mb-4">Quick Stats</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                  <div className="text-2xl font-bold text-primary">{videos.length}</div>
                  <div className="text-xs text-muted-foreground mt-1">Videos</div>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                  <div className="text-2xl font-bold text-primary">{steps.length}</div>
                  <div className="text-xs text-muted-foreground mt-1">Steps</div>
                </div>
              </div>
            </div>

            <div className="card p-6">
              <h3 className="text-sm font-semibold text-foreground mb-3">Features</h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                  AI-powered script generation
                </li>
                <li className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                  Multi-language support
                </li>
                <li className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                  Direct YouTube upload
                </li>
                <li className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                  Automated scheduling
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* Cron Jobs */}
        <CronJobManager apiBase={apiBase} addNotification={addNotification} />

        {/* Video Library */}
        <div className="card p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Video Library</h2>
              <p className="text-sm text-muted-foreground mt-1">
                {videos.length} {videos.length === 1 ? "video" : "videos"} generated
              </p>
            </div>
          </div>

          {videos.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">No videos yet. Generate your first video above.</p>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {videos.map((video) => (
                <button
                  key={video.id}
                  onClick={() => handleVideoSelect(video)}
                  className="card p-4 hover:shadow-md transition-all duration-200 text-left group"
                >
                  <div className="aspect-video bg-slate-100 dark:bg-slate-800 rounded-lg mb-3 overflow-hidden">
                    {video.videoUrl && (getYouTubeVideoId(video.videoUrl)) ? (
                      <img
                        src={`https://img.youtube.com/vi/${getYouTubeVideoId(video.videoUrl)}/mqdefault.jpg`}
                        alt={video.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <svg className="w-12 h-12 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      </div>
                    )}
                  </div>
                  <h3 className="font-medium text-foreground line-clamp-2 mb-1 text-sm">
                    {video.title}
                  </h3>
                  <div className="flex items-center gap-2 mt-2">
                    <span className="badge badge-primary">{video.mode || "generic"}</span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(video.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
