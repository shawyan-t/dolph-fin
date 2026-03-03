"use client";

import ReactMarkdown from "react-markdown";

interface ReportSection {
  id: string;
  title: string;
  content: string;
}

interface ReportViewProps {
  sections: ReportSection[];
  tickers: string[];
  generatedAt?: string;
}

export function ReportView({ sections, tickers, generatedAt }: ReportViewProps) {
  if (sections.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-neutral-600">
        <p>Report will appear here as it&apos;s generated...</p>
      </div>
    );
  }

  return (
    <div className="report-content">
      {/* Report Header */}
      <div className="mb-8 pb-4 border-b border-[#262626]">
        <h1 className="text-2xl font-bold text-white mb-1">
          {tickers.length === 1
            ? `${tickers[0]} Financial Analysis`
            : `${tickers.join(" vs ")} Comparison`
          }
        </h1>
        {generatedAt && (
          <p className="text-sm text-neutral-500">
            Generated {new Date(generatedAt).toLocaleString()}
          </p>
        )}
      </div>

      {/* Report Sections */}
      {sections.map((section) => (
        <div key={section.id} className="mb-6" id={section.id}>
          <ReactMarkdown>{`## ${section.title}\n\n${section.content}`}</ReactMarkdown>
        </div>
      ))}
    </div>
  );
}
