import { useState } from "react";

type VideoItem = {
  id: string;
  title: string;
  topic: string;
  createdAt: string;
  videoUrl: string | null;
};

type VideoGridProps = {
  items: VideoItem[];
  onVideoSelect?: (video: VideoItem) => void;
};

export function VideoGrid({ items, onVideoSelect }: VideoGridProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (!items.length) {
    return (
      <div className="text-center py-8">
        <p className="text-sm text-steel">No videos generated yet.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {items.map((item) => {
        const isExpanded = expandedId === item.id;

        return (
          <div key={item.id} className="brutal-card p-4 space-y-3">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs uppercase tracking-wide text-steel bg-haze px-2 py-1 inline-block rounded">
                  {item.topic}
                </p>
                <h3 className="text-lg font-semibold mt-2">{item.title || "Untitled"}</h3>
                <p className="text-xs text-steel mt-1">
                  {new Date(item.createdAt).toLocaleDateString()}
                </p>
              </div>
              <button
                onClick={() => setExpandedId(isExpanded ? null : item.id)}
                className="text-steel hover:text-ink"
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
                <video controls className="w-full border-2 border-ink mt-3">
                  <source src={item.videoUrl} type="video/mp4" />
                </video>

                {isExpanded && (
                  <div className="mt-3 pt-3 border-t border-haze flex space-x-2">
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
                      onClick={() => onVideoSelect?.(item)}
                      className="brutal-button brutal-button-secondary flex-1 px-3 py-2 text-sm flex items-center justify-center space-x-1"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 101.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                      </svg>
                      <span>View</span>
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="text-sm text-steel mt-3">Video unavailable.</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
