type StepStatusProps = {
  steps: string[];
  activeIndex: number;
};

export function StepStatus({ steps, activeIndex }: StepStatusProps) {
  return (
    <div className="space-y-3">
      {steps.map((step, index) => {
        const isActive = index === activeIndex;
        const isDone = index < activeIndex;
        return (
          <div
            key={step}
            className={`flex items-center justify-between px-4 py-3 brutal-card transition-all duration-300 ${
              isActive
                ? "bg-signal text-ink"
                : isDone
                  ? "bg-green-100 border-green-500 dark:bg-green-900/40 dark:border-green-700"
                  : "bg-bone"
            }`}
          >
            <div className="font-mono text-sm uppercase tracking-wide">{step}</div>
            <div className="text-xs">
              {isDone ? (
                <span className="text-green-600 dark:text-green-300">done</span>
              ) : isActive ? (
                <span className="text-signal font-bold">working</span>
              ) : (
                <span className="text-steel">queued</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
