"use client";

import { useEffect, useState, useRef } from "react";
import { EnhancedStepStatus } from "../components/EnhancedStepStatus";
import { EnhancedVideoGrid } from "../components/EnhancedVideoGrid";
import { LoadingSpinner } from "../components/LoadingSpinner";
import { Notification } from "../components/Notification";
import { ThemeToggle } from "../components/ThemeToggle";

const steps = [
  "Generating script with AI",
  "Searching for relevant images",
  "Creating voice narration",
  "Rendering final video"
];

type VideoItem = {
  id: string;
  title: string;
  topic: string;
  createdAt: string;
  videoUrl: string | null;
  mode?: "generic" | "detailed";
};

type NotificationType = {
  id: number;
  message: string;
  type: "success" | "error" | "info" | "warning";
};

const SUPPORTED_LANGUAGES = [
  { code: "en-IN", label: "English", flag: "🇬🇧" },
  { code: "hi-IN", label: "Hindi / हिन्दी", flag: "🇮🇳" },
  { code: "bn-IN", label: "Bengali / বাংলা", flag: "🇧🇩" },
  { code: "te-IN", label: "Telugu / తెలుగు", flag: "🇮🇳" },
  { code: "ta-IN", label: "Tamil / தமிழ்", flag: "🇮🇳" },
  { code: "mr-IN", label: "Marathi / मराठी", flag: "🇮🇳" },
  { code: "gu-IN", label: "Gujarati / ગુજરાતી", flag: "🇮🇳" },
  { code: "kn-IN", label: "Kannada / ಕನ್ನಡ", flag: "🇮🇳" },
  { code: "ml-IN", label: "Malayalam / മലയാളം", flag: "🇮🇳" },
  { code: "od-IN", label: "Odia / ଓଡ଼ିଆ", flag: "🇮🇳" },
  { code: "pa-IN", label: "Punjabi / ਪੰਜਾਬੀ", flag: "🇮🇳" },
];

export default function Home() {
  const [topic, setTopic] = useState("");
  const [selectedLanguage, setSelectedLanguage] = useState("en-IN");
  const [selectedMode, setSelectedMode] = useState<"generic" | "detailed">("generic");
  const [isLoading, setIsLoading] = useState(false);
  const [activeStep, setActiveStep] = useState(0);
  const [currentVideo, setCurrentVideo] = useState<VideoItem | null>(null);
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [progressMessage, setProgressMessage] = useState("");
  const [notifications, setNotifications] = useState<NotificationType[]>([]);
  const videoRef = useRef<HTMLDivElement>(null);

  const apiBase = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:4000";

  // Add notification function
  const addNotification = (message: string, type: NotificationType["type"]) => {
    const id = Date.now();
    setNotifications((prev) => [...prev, { id, message, type }]);

    // Auto remove notification after 5 seconds
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
      addNotification("Failed to load videos", "error");
    }
  };

  useEffect(() => {
    loadVideos();
  }, []);

  useEffect(() => {
    if (!isLoading) {
      return;
    }

    let stepIndex = 0;
    setActiveStep(stepIndex);

    const stepMessages = selectedMode === "detailed"
      ? [
          "Crafting your story with Gemini AI...",
          "Generating voice narration per section...",
          "Writing custom animation code for each scene...",
          "Rendering with Remotion (5-10 min for detailed mode)...",
        ]
      : [
          "Crafting your story with Gemini AI...",
          "Finding the perfect visuals on Unsplash...",
          "Generating natural sounding voice...",
          "Seamlessly stitching everything together...",
        ];

    setProgressMessage(stepMessages[stepIndex]);

    const timer = setInterval(() => {
      stepIndex += 1;
      if (stepIndex < steps.length) {
        setActiveStep(stepIndex);
        setProgressMessage(stepMessages[stepIndex]);
      }
    }, 2000);

    return () => clearInterval(timer);
  }, [isLoading]);

  const handleGenerate = async () => {
    if (!topic.trim()) {
      setError("Please enter a topic first");
      addNotification("Please enter a topic first", "warning");
      return;
    }

    setError(null);
    setCurrentVideo(null);
    setIsLoading(true);
    setActiveStep(0);
    setProgressMessage("Initializing video creation...");

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
        videoUrl: data.videoUrl
      });

      await loadVideos();
      addNotification("Video generated successfully!", "success");
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Something went wrong";
      setError(errorMessage);
      addNotification(errorMessage, "error");
    } finally {
      setIsLoading(false);
      setProgressMessage("");
    }
  };

  const handleVideoSelect = (video: VideoItem) => {
    setCurrentVideo(video);
    if (videoRef.current) {
      videoRef.current.scrollIntoView({ behavior: "smooth" });
    }
  };

  const handleCopyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      addNotification("Video link copied to clipboard!", "success");
    } catch (err) {
      addNotification("Failed to copy link", "error");
    }
  };

  const sampleTopics = [
    "The future of renewable energy",
    "How AI is changing education",
    "Journey through the solar system",
    "History of ancient civilizations",
    "Healthy eating habits for busy people"
  ];

  return (
    <main className="min-h-screen px-4 py-8 md:px-8">
      {/* Notifications */}
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

      <div className="max-w-6xl mx-auto space-y-12">
        {/* Header */}
        <header className="text-center py-8">
          <div className="flex justify-between items-center mb-4">
            <div></div> {/* Spacer for symmetry */}
            <ThemeToggle />
          </div>
          <h1 className="text-4xl md:text-6xl font-bold text-ink mb-4">
            AI Video <span className="text-signal">Generator</span>
          </h1>
          <p className="text-xl text-steel max-w-2xl mx-auto">
            Transform any topic into a captivating video with AI-powered scriptwriting, imagery, and voice narration
          </p>
        </header>

        {/* Main Content */}
        <div className="grid gap-8 lg:grid-cols-3">
          {/* Input Section */}
          <div className="lg:col-span-2 space-y-8">
            <section className="brutal-card p-6">
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold text-ink mb-2">Create Your Video</h2>
                  <p className="text-steel">
                    Enter any topic and our AI will generate a complete video with script, images, and narration
                  </p>
                </div>

                <div className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div className="sm:col-span-2">
                      <label htmlFor="topic" className="block text-sm font-medium text-steel mb-2">
                        Video Topic
                      </label>
                      <textarea
                        id="topic"
                        className="brutal-input w-full min-h-[120px] p-4 resize-none"
                        placeholder="Enter a topic like 'The impact of climate change on coral reefs' or 'How quantum computing works'"
                        value={topic}
                        onChange={(event) => setTopic(event.target.value)}
                      />
                    </div>
                    <div>
                      <label htmlFor="language" className="block text-sm font-medium text-steel mb-2">
                        Narration Language
                      </label>
                      <select
                        id="language"
                        className="brutal-input w-full p-3 h-[120px] cursor-pointer"
                        value={selectedLanguage}
                        onChange={(e) => setSelectedLanguage(e.target.value)}
                        size={5}
                      >
                        {SUPPORTED_LANGUAGES.map((lang) => (
                          <option key={lang.code} value={lang.code}>
                            {lang.flag} {lang.label}
                          </option>
                        ))}
                      </select>
                      <p className="text-xs text-steel mt-1">
                        Script &amp; voice in selected language
                      </p>
                    </div>
                  </div>

                  {/* Mode selector */}
                  <div>
                    <label htmlFor="mode" className="block text-sm font-medium text-steel mb-2">
                      Video Mode
                    </label>
                    <select
                      id="mode"
                      className="brutal-input w-full p-3 cursor-pointer"
                      value={selectedMode}
                      onChange={(e) => setSelectedMode(e.target.value as "generic" | "detailed")}
                    >
                      <option value="generic">🎬 Generic — Fast photo slideshow with Ken Burns effects</option>
                      <option value="detailed">🎨 Detailed — AI-animated content-specific visuals (5-10 min)</option>
                    </select>
                    {selectedMode === "detailed" && (
                      <p className="text-xs text-steel mt-1 font-medium text-amber-600 dark:text-amber-400">
                        ⚠️ Detailed mode generates custom animations with Remotion. Rendering takes 5–10 minutes.
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <span className="text-sm text-steel">Try these:</span>
                    {sampleTopics.map((sampleTopic, index) => (
                      <button
                        key={index}
                        type="button"
                        className="chip text-xs"
                        onClick={() => setTopic(sampleTopic)}
                      >
                        {sampleTopic}
                      </button>
                    ))}
                  </div>

                  <button
                    className={`brutal-button w-full py-4 font-bold text-lg uppercase tracking-wide flex items-center justify-center space-x-2 ${
                      isLoading ? "opacity-75 cursor-not-allowed" : ""
                    }`}
                    onClick={handleGenerate}
                    disabled={isLoading}
                  >
                    {isLoading ? (
                      <>
                        <div className="w-5 h-5 border-2 border-ink border-t-transparent rounded-full animate-spin"></div>
                        <span>Generating Video...</span>
                      </>
                    ) : (
                      <>
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span>{selectedMode === "detailed" ? "Generate Detailed Video" : "Generate My Video"}</span>
                      </>
                    )}
                  </button>

                  {error && (
                    <div className="brutal-card bg-red-100 border-red-500 p-4 dark:bg-red-950/30 dark:border-red-700">
                      <div className="flex items-center">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-red-600 mr-2" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                        <span className="text-red-700 font-medium dark:text-red-200">{error}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </section>

            {/* Preview Section */}
            {(isLoading || currentVideo) && (
              <section className="brutal-card p-6" ref={videoRef}>
                <h2 className="text-2xl font-bold text-ink mb-4">
                  {isLoading ? "Generating Your Video" : "Your Generated Video"}
                </h2>

                {isLoading ? (
                  <div className="space-y-6">
                    <LoadingSpinner message={progressMessage} />
                    <EnhancedStepStatus steps={steps} activeIndex={activeStep} isLoading={isLoading} />
                  </div>
                ) : currentVideo && currentVideo.videoUrl ? (
                  <div className="space-y-6">
                    <div className="aspect-video bg-black rounded overflow-hidden">
                      <video
                        controls
                        className="w-full h-full"
                        autoPlay
                      >
                        <source src={currentVideo.videoUrl} type="video/mp4" />
                        Your browser does not support the video tag.
                      </video>
                    </div>

                    <div className="flex flex-wrap gap-3">
                      <a
                        href={currentVideo.videoUrl}
                        download
                        className="brutal-button px-6 py-3 flex items-center space-x-2"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                        <span>Download Video</span>
                      </a>

                      <button
                        onClick={() => handleCopyLink(currentVideo.videoUrl || "")}
                        className="brutal-button brutal-button-secondary px-6 py-3 flex items-center space-x-2"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                          <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
                          <path d="M6 3a2 2 0 012-2v0h4a2 2 0 012 2v0a2 2 0 01-2 2v0H8a2 2 0 01-2-2v0z" />
                          <path d="M6 3a2 2 0 012-2v0h4a2 2 0 012 2v0a2 2 0 01-2 2v0H8a2 2 0 01-2-2v0z" />
                          <path d="M6 3a2 2 0 012-2v0h4a2 2 0 012 2v0a2 2 0 01-2 2v0H8a2 2 0 01-2-2v0z" />
                          <path d="M6 3a2 2 0 012-2v0h4a2 2 0 012 2v0a2 2 0 01-2 2v0H8a2 2 0 01-2-2v0z" />
                          <path d="M6 3a2 2 0 012-2v0h4a2 2 0 012 2v0a2 2 0 01-2 2v0H8a2 2 0 01-2-2v0z" />
                          <path d="M6 3a2 2 0 012-2v0h4a2 2 0 012 2v0a2 2 0 01-2 2v0H8a2 2 0 01-2-2v0z" />
                          <path d="M11 8a1 1 0 10-2 0v5a1 1 0 102 0V8zM9 11a1 1 0 012 0v2a1 1 0 11-2 0v-2z" />
                        </svg>
                        <span>Copy Video Link</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <p className="text-steel">Video could not be loaded</p>
                  </div>
                )}
              </section>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Stats Card */}
            <div className="brutal-card p-6">
              <h3 className="text-lg font-bold text-ink mb-4">Your Video Stats</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="brutal-card p-3 text-center">
                  <div className="text-2xl font-bold text-signal">{videos.length}</div>
                  <div className="text-sm text-steel">Videos Created</div>
                </div>
                <div className="brutal-card p-3 text-center">
                  <div className="text-2xl font-bold text-signal">{steps.length}</div>
                  <div className="text-sm text-steel">Steps</div>
                </div>
              </div>
            </div>

            {/* Process Info */}
            <div className="brutal-card p-6">
              <h3 className="text-lg font-bold text-ink mb-4">How It Works</h3>
              {selectedMode === "generic" ? (
                <ul className="space-y-3 text-sm">
                  <li className="flex items-start space-x-2">
                    <div className="w-6 h-6 rounded-full bg-signal text-ink flex items-center justify-center flex-shrink-0 mt-0.5">1</div>
                    <span className="text-steel">AI generates a structured script from your topic</span>
                  </li>
                  <li className="flex items-start space-x-2">
                    <div className="w-6 h-6 rounded-full bg-signal text-ink flex items-center justify-center flex-shrink-0 mt-0.5">2</div>
                    <span className="text-steel">Relevant images fetched &amp; animated with Ken Burns effects</span>
                  </li>
                  <li className="flex items-start space-x-2">
                    <div className="w-6 h-6 rounded-full bg-signal text-ink flex items-center justify-center flex-shrink-0 mt-0.5">3</div>
                    <span className="text-steel">Voice narration created with Sarvam AI bulbul:v2</span>
                  </li>
                  <li className="flex items-start space-x-2">
                    <div className="w-6 h-6 rounded-full bg-signal text-ink flex items-center justify-center flex-shrink-0 mt-0.5">4</div>
                    <span className="text-steel">Final video rendered with FFmpeg (~1-2 min)</span>
                  </li>
                </ul>
              ) : (
                <ul className="space-y-3 text-sm">
                  <li className="flex items-start space-x-2">
                    <div className="w-6 h-6 rounded-full bg-signal text-ink flex items-center justify-center flex-shrink-0 mt-0.5">1</div>
                    <span className="text-steel">AI generates a detailed script tailored for animation</span>
                  </li>
                  <li className="flex items-start space-x-2">
                    <div className="w-6 h-6 rounded-full bg-signal text-ink flex items-center justify-center flex-shrink-0 mt-0.5">2</div>
                    <span className="text-steel">Sarvam AI generates voice narration per section</span>
                  </li>
                  <li className="flex items-start space-x-2">
                    <div className="w-6 h-6 rounded-full bg-signal text-ink flex items-center justify-center flex-shrink-0 mt-0.5">3</div>
                    <span className="text-steel">Gemini writes custom Remotion animation code for each scene (molecular diagrams, charts, flowcharts, etc.)</span>
                  </li>
                  <li className="flex items-start space-x-2">
                    <div className="w-6 h-6 rounded-full bg-signal text-ink flex items-center justify-center flex-shrink-0 mt-0.5">4</div>
                    <span className="text-steel">Remotion renders each animated scene via headless Chrome</span>
                  </li>
                  <li className="flex items-start space-x-2">
                    <div className="w-6 h-6 rounded-full bg-signal text-ink flex items-center justify-center flex-shrink-0 mt-0.5">5</div>
                    <span className="text-steel">FFmpeg concatenates all scenes into the final video (~5-10 min total)</span>
                  </li>
                </ul>
              )}
            </div>
          </div>
        </div>

        {/* Previous Videos */}
        <section className="brutal-card p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-bold text-ink">Your Video Library</h2>
            <span className="text-sm text-steel">
              {videos.length} {videos.length === 1 ? "video" : "videos"}
            </span>
          </div>

          <EnhancedVideoGrid items={videos} onVideoSelect={handleVideoSelect} />
        </section>
      </div>
    </main>
  );
}
