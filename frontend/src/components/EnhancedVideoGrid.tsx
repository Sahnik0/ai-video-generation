import { useState } from "react";

type VideoItem = {
  id: string;
  title: string;
  topic: string;
  createdAt: string;
  videoUrl: string | null;
};

type EnhancedVideoGridProps = {
  items: VideoItem[];
  onVideoSelect?: (video: VideoItem) => void;
};

export function EnhancedVideoGrid({ items, onVideoSelect }: EnhancedVideoGridProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  if (!items.length) {
    return (
      <div className="text-center py-12">
        <div className="inline-block p-6 brutal-card bg-bone">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 mx-auto text-steel mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          <p className="text-steel font-medium dark:text-haze">No videos generated yet</p>
          <p className="text-sm text-steel mt-2 dark:text-haze">Enter a topic above to create your first video</p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => {
        const isExpanded = expandedId === item.id;
        const isHovered = hoveredId === item.id;

        return (
          <div
            key={item.id}
            className={`brutal-card overflow-hidden transition-all duration-300 ${
              isExpanded ? "row-span-2" : ""
            }`}
            onMouseEnter={() => setHoveredId(item.id)}
            onMouseLeave={() => setHoveredId(null)}
          >
            <div className="p-4">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-xs uppercase tracking-wide text-steel bg-haze px-2 py-1 inline-block rounded dark:text-haze dark:bg-steel">
                    {item.topic}
                  </p>
                  <h3 className="text-lg font-bold mt-2 line-clamp-2 text-ink dark:text-bone">{item.title || "Untitled"}</h3>
                  <p className="text-xs text-steel mt-1 dark:text-haze">
                    {new Date(item.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <button
                  onClick={() => setExpandedId(isExpanded ? null : item.id)}
                  className="text-steel hover:text-ink transition-colors dark:text-haze dark:hover:text-bone"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className={`h-5 w-5 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>

              {item.videoUrl ? (
                <>
                  <div className="mt-4 relative group">
                    <video
                      controls
                      className="w-full border-2 border-ink rounded"
                      style={{ aspectRatio: "16/9" }}
                    >
                      <source src={item.videoUrl} type="video/mp4" />
                    </video>
                    {isHovered && (
                      <div className="absolute inset-0 bg-black bg-opacity-30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => onVideoSelect?.(item)}
                          className="brutal-button px-4 py-2 text-sm flex items-center space-x-2"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                          </svg>
                          <span>View Full</span>
                        </button>
                      </div>
                    )}
                  </div>

                  {isExpanded && (
                    <div className="mt-4 pt-4 border-t border-haze">
                      <div className="flex space-x-2">
                        <a
                          href={item.videoUrl}
                          download
                          className="brutal-button flex-1 px-3 py-2 text-sm flex items-center justify-center space-x-1"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
                          </svg>
                          <span>Download</span>
                        </a>
                        <button
                          onClick={() => navigator.clipboard.writeText(item.videoUrl || "")}
                          className="brutal-button brutal-button-secondary flex-1 px-3 py-2 text-sm flex items-center justify-center space-x-1"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
                            <path d="M6 3a2 2 0 012-2v0h4a2 2 0 012 2v0a2 2 0 01-2 2v0H8a2 2 0 01-2-2v0z" />
                            <path d="M6 3a2 2 0 012-2v0h4a2 2 0 012 2v0a2 2 0 01-2 2v0H8a2 2 0 01-2-2v0z" />
                            <path d="M6 3a2 2 0 012-2v0h4a2 2 0 012 2v0a2 2 0 01-2 2v0H8a2 2 0 01-2-2v0z" />
                            <path d="M6 3a2 2 0 012-2v0h4a2 2 0 012 2v0a2 2 0 01-2 2v0H8a2 2 0 01-2-2v0z" />
                            <path d="M6 3a2 2 0 012-2v0h4a2 2 0 012 2v0a2 2 0 01-2 2v0H8a2 2 0 01-2-2v0z" />
                            <path d="M6 3a2 2 0 012-2v0h4a2 2 0 012 2v0a2 2 0 01-2 2v0H8a2 2 0 01-2-2v0z" />
                            <path d="M11 8a1 1 0 10-2 0v5a1 1 0 102 0V8zM9 11a1 1 0 012 0v2a1 1 0 11-2 0v-2z" />
                          </svg>
                          <span>Copy Link</span>
                        </button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="mt-4 text-center py-8 bg-haze rounded border-2 border-dashed border-steel dark:bg-steel dark:border-haze">
                  <p className="text-steel dark:text-bone">Video unavailable</p>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}