"use client";

interface ChartDisplayProps {
  revenueMarginChart: string | null;
  fcfBridgeChart: string | null;
  peerScorecardChart: string | null;
  returnLeverageChart: string | null;
  growthDurabilityChart: string | null;
}

export function ChartDisplay({
  revenueMarginChart,
  fcfBridgeChart,
  peerScorecardChart,
  returnLeverageChart,
  growthDurabilityChart,
}: ChartDisplayProps) {
  const toDataUri = (svg: string) =>
    `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

  const charts = [
    { label: "Revenue & Margins", svg: revenueMarginChart },
    { label: "Free Cash Flow Bridge", svg: fcfBridgeChart },
    { label: "Revenue Growth Durability", svg: growthDurabilityChart },
    { label: "Peer Scorecard (Z-Score)", svg: peerScorecardChart },
    { label: "Return vs Leverage", svg: returnLeverageChart },
  ].filter((c) => c.svg);

  if (charts.length === 0) return null;

  return (
    <div className="mb-6">
      <h2 className="text-lg font-semibold text-white mb-4">Visual Analysis</h2>
      <div className="flex flex-col gap-4">
        {charts.map((chart, i) => (
          <div key={i}>
            <p className="text-xs text-neutral-500 mb-1">{chart.label}</p>
            <div className="bg-white rounded-lg p-2 overflow-hidden">
              <img
                src={toDataUri(chart.svg!)}
                alt={chart.label}
                className="w-full h-auto block"
                loading="lazy"
                decoding="async"
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
