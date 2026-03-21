"use client";

import { useEffect, useState, useRef } from "react";
import { Notification } from "../components/Notification";
import { CronJobManager } from "../components/CronJobManager";
import { YouTubeVideoForm } from "../components/YouTubeVideoForm";

type VideoItem = {
  id: string;
  title: string;
  topic: string;
  createdAt: string;
  videoUrl: string | null;
  youtubeVideoId?: string;
  uploadTarget?: "s3" | "youtube";
  mode?: "generic" | "detailed";
};

type NotificationType = {
  id: number;
  message: string;
  type: "success" | "error" | "info" | "warning";
};

type Tab = "scheduled" | "youtube";

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>("scheduled");
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [currentVideo, setCurrentVideo] = useState<VideoItem | null>(null);
  const [notifications, setNotifications] = useState<NotificationType[]>([]);
  const videoRef = useRef<HTMLDivElement>(null);

  const apiBase = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:4000";

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

  const loadVideos = async (silent = false) => {
    const MAX_RETRIES = 3;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(`${apiBase}/api/videos`);
        const data = await response.json();
        const items: VideoItem[] = data.items || [];
        setVideos(items);
        setCurrentVideo((prev) => {
          if (prev) {
            const stillExists = items.find((video) => video.id === prev.id);
            return stillExists || items[0] || null;
          }
          return items[0] || null;
        });
        return; // success
      } catch (err) {
        if (attempt < MAX_RETRIES - 1) {
          // Wait 2s before retrying (backend may still be starting)
          await new Promise((r) => setTimeout(r, 2000));
        } else {
          console.error("Failed to load videos after retries:", err);
          if (!silent) addNotification("Could not reach backend. Is the server running?", "warning");
        }
      }
    }
  };

  useEffect(() => {
    document.documentElement.classList.remove("dark");
    localStorage.setItem("theme", "light");
    loadVideos(true); // silent=true on initial load to avoid showing errors during backend startup
  }, []);

  const handleVideoSelect = (video: VideoItem) => {
    setCurrentVideo(video);
    videoRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  /** Called by YouTubeVideoForm when a new video is finished rendering */
  const handleYouTubeVideoReady = (result: { videoUrl: string; title: string; videoId: string }) => {
    // Reload the video library to show the new video
    loadVideos();
    // Set the newly generated video as the current one so it's visible
    const newVideo: VideoItem = {
      id: result.videoId,
      title: result.title,
      topic: result.title,
      createdAt: new Date().toISOString(),
      videoUrl: result.videoUrl,
      uploadTarget: "s3",
      mode: "detailed",
    };
    setCurrentVideo(newVideo);
    videoRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <main className="min-h-screen">
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

      <header className="sticky top-0 z-40 border-b border-border/70 bg-white/70 backdrop-blur-md dark:bg-slate-950/70 animate-fade-in">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">AI Video Scheduler</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Automated rendering and scheduled publishing</p>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6 animate-fade-up">

            {/* ── Tab switcher ─────────────────────────────────────────────── */}
            <div className="flex gap-1 p-1 bg-secondary rounded-xl w-fit">
              <button
                onClick={() => setActiveTab("scheduled")}
                className={`px-5 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                  activeTab === "scheduled"
                    ? "bg-white dark:bg-slate-800 text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                📅 Scheduled Jobs
              </button>
              <button
                onClick={() => setActiveTab("youtube")}
                className={`px-5 py-2 rounded-lg text-sm font-medium transition-all duration-200 flex items-center gap-1.5 ${
                  activeTab === "youtube"
                    ? "bg-white dark:bg-slate-800 text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                🎥 Fetch from YouTube
              </button>
            </div>

            {/* ── Tab content ──────────────────────────────────────────────── */}
            {activeTab === "scheduled" && (
              <CronJobManager apiBase={apiBase} addNotification={addNotification} />
            )}

            {activeTab === "youtube" && (
              <YouTubeVideoForm
                apiBase={apiBase}
                addNotification={addNotification}
                onVideoReady={handleYouTubeVideoReady}
              />
            )}

            {/* ── Current video player ─────────────────────────────────────── */}
            {currentVideo ? (
              <div className="card p-6 space-y-4 animate-fade-up" ref={videoRef}>
                <div>
                  <h3 className="text-lg font-semibold text-foreground">{currentVideo.title}</h3>
                  <p className="text-sm text-muted-foreground mt-1">Most recent scheduled upload</p>
                </div>

                <div className="aspect-video bg-black rounded-lg overflow-hidden">
                  {currentVideo.videoUrl && (currentVideo.videoUrl.includes("youtube.com") || currentVideo.videoUrl.includes("youtu.be")) ? (
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
                      <source src={currentVideo.videoUrl || ""} type="video/mp4" />
                    </video>
                  )}
                </div>

                {currentVideo.videoUrl && (
                  <div className="flex gap-3">
                    <a
                      href={currentVideo.videoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-primary px-6 h-10"
                    >
                      {currentVideo.uploadTarget === "youtube" ? "Watch on YouTube" : "Open Video"}
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
                )}
              </div>
            ) : (
              <div className="card p-6 animate-fade-up" ref={videoRef}>
                <h3 className="text-lg font-semibold text-foreground">Waiting for uploads</h3>
                <p className="text-sm text-muted-foreground mt-1">Videos produced by your scheduled jobs will appear here once ready.</p>
              </div>
            )}
          </div>

          <div className="space-y-6 animate-fade-up" style={{ animationDelay: "80ms" }}>
            <div className="card p-6">
              <h3 className="text-sm font-semibold text-foreground mb-4">Status</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-secondary">
                  <div className="text-2xl font-bold text-primary">{videos.length}</div>
                  <div className="text-xs text-muted-foreground mt-1">Uploaded videos</div>
                </div>
                <div className="p-3 rounded-lg bg-secondary">
                  <div className="text-2xl font-bold text-primary">∞</div>
                  <div className="text-xs text-muted-foreground mt-1">Hands-off runs</div>
                </div>
              </div>
            </div>

            <div className="card p-6 space-y-3">
              <h3 className="text-sm font-semibold text-foreground">How it works</h3>
              <div className="space-y-2.5 text-sm text-muted-foreground">
                <div className="flex items-start gap-2">
                  <span>📅</span>
                  <span><strong className="text-foreground">Scheduled Jobs</strong> — set a recurring topic and the AI generates + uploads automatically</span>
                </div>
                <div className="flex items-start gap-2">
                  <span>🎥</span>
                  <span><strong className="text-foreground">From YouTube</strong> — paste a lecture URL; we transcribe, organize and animate it</span>
                </div>
              </div>
              <button
                onClick={() => loadVideos(false)}
                className="btn btn-secondary w-full h-10"
              >
                Refresh Library
              </button>
            </div>
          </div>
        </div>

        {/* ── Video Library ────────────────────────────────────────────────── */}
        <div className="card p-6 max-h-[720px] overflow-y-auto animate-fade-up" style={{ animationDelay: "120ms" }}>
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Video Library</h2>
              <p className="text-sm text-muted-foreground mt-1">
                {videos.length} {videos.length === 1 ? "video" : "videos"} from scheduled runs
              </p>
            </div>
          </div>

          {videos.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">No videos yet. Scheduled jobs will populate this list.</p>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {videos.map((video) => (
                <button
                  key={video.id}
                  onClick={() => handleVideoSelect(video)}
                  className="panel p-4 text-left group transition-all duration-200 hover:-translate-y-0.5 animate-soft-pop"
                >
                  <div className="aspect-video bg-secondary rounded-lg mb-3 overflow-hidden">
                    {video.videoUrl && getYouTubeVideoId(video.videoUrl) ? (
                      <img
                        src={`https://img.youtube.com/vi/${getYouTubeVideoId(video.videoUrl)}/mqdefault.jpg`}
                        alt={video.title}
                        className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-200"
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
