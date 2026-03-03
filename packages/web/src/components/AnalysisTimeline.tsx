"use client";

interface TimelineStep {
  step: string;
  status: "running" | "complete" | "error";
  detail?: string;
}

interface AnalysisTimelineProps {
  steps: TimelineStep[];
}

export function AnalysisTimeline({ steps }: AnalysisTimelineProps) {
  return (
    <div className="space-y-1">
      <h3 className="text-sm font-semibold text-neutral-400 uppercase tracking-wider mb-3">
        Pipeline
      </h3>
      {steps.map((step, idx) => (
        <div key={idx} className="flex items-start gap-3 py-1.5">
          {/* Status icon */}
          <div className="flex-shrink-0 mt-0.5">
            {step.status === "running" && (
              <div className="w-4 h-4 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
            )}
            {step.status === "complete" && (
              <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
            {step.status === "error" && (
              <svg className="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            )}
          </div>

          {/* Step text */}
          <div className="flex-1 min-w-0">
            <p className={`text-sm truncate ${
              step.status === "running" ? "text-cyan-400" :
              step.status === "complete" ? "text-neutral-300" :
              "text-red-400"
            }`}>
              {step.step}
            </p>
            {step.detail && (
              <p className="text-xs text-neutral-500 mt-0.5 truncate">
                {step.detail}
              </p>
            )}
          </div>
        </div>
      ))}

      {steps.length === 0 && (
        <p className="text-sm text-neutral-600 italic">Initializing...</p>
      )}
    </div>
  );
}
