"use client";

interface RenderedChart {
  key: string;
  title: string;
  caption: string;
  assetType: "svg" | "png";
  mimeType: string;
  content: string;
}

function toAssetSrc(chart: RenderedChart): string {
  if (chart.assetType === "svg") {
    return `data:${chart.mimeType};charset=utf-8,${encodeURIComponent(chart.content)}`;
  }
  return chart.content;
}

export function RenderedChartGallery({ charts }: { charts: RenderedChart[] }) {
  if (!charts.length) return null;

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-border/60 bg-background/55 px-5 py-4">
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Visuals</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Rendered from the same canonical report package used by the PDF exporter.
        </p>
      </div>
      {charts.map((chart) => (
        <div key={chart.key} className="rounded-2xl border border-border/60 bg-background/55 p-4">
          <h3 className="text-lg font-semibold text-foreground">{chart.title}</h3>
          {chart.caption ? (
            <p className="mt-1 text-sm leading-6 text-muted-foreground">{chart.caption}</p>
          ) : null}
          <div className="mt-4 overflow-hidden rounded-xl border border-border/50 bg-white p-2">
            <img
              src={toAssetSrc(chart)}
              alt={chart.title}
              className="block h-auto w-full"
              loading="lazy"
              decoding="async"
            />
          </div>
        </div>
      ))}
    </div>
  );
}
