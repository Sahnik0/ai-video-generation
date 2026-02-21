import { useState, useEffect } from "react";

type EnhancedStepStatusProps = {
  steps: string[];
  activeIndex: number;
  isLoading: boolean;
};

export function EnhancedStepStatus({ steps, activeIndex, isLoading }: EnhancedStepStatusProps) {
  const [animatedIndex, setAnimatedIndex] = useState(activeIndex);

  useEffect(() => {
    if (isLoading) {
      setAnimatedIndex(activeIndex);
    }
  }, [activeIndex, isLoading]);

  return (
    <div className="space-y-4">
      <h3 className="text-xl font-bold text-ink dark:text-bone">Generation Progress</h3>
      <div className="space-y-3">
        {steps.map((step, index) => {
          const isActive = index === animatedIndex && isLoading;
          const isDone = index < animatedIndex || (index === animatedIndex && !isLoading && activeIndex !== -1);
          const isPending = index > animatedIndex;

          return (
            <div
              key={index}
              className={`flex items-center justify-between px-4 py-3 brutal-card transition-all duration-300 ${
                isActive
                  ? "bg-signal text-ink dark:text-bone shadow-lg scale-[1.02]"
                  : isDone
                    ? "bg-green-100 border-green-500 dark:bg-green-900 dark:border-green-700"
                    : "bg-bone dark:bg-steel"
              }`}
            >
              <div className="flex items-center space-x-3">
                <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${
                  isActive
                    ? "bg-signal text-ink dark:text-bone"
                    : isDone
                      ? "bg-green-500 text-white dark:bg-green-600"
                      : "bg-haze dark:bg-steel"
                }`}>
                  {isDone ? (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  ) : isActive ? (
                    <div className="w-2 h-2 bg-ink rounded-full animate-pulse"></div>
                  ) : (
                    <span className="text-xs font-bold">{index + 1}</span>
                  )}
                </div>
                <div className="font-medium text-sm">{step}</div>
              </div>
              <div className="text-xs">
                {isDone ? (
                  <span className="text-green-600 font-medium dark:text-green-400">Completed</span>
                ) : isActive ? (
                  <span className="text-signal font-bold animate-pulse dark:text-orange-300">Processing...</span>
                ) : (
                  <span className="text-steel dark:text-haze">Pending</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}