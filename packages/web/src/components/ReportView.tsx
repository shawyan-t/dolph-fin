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

interface ParsedTable {
  headers: string[];
  rows: string[][];
}

type ParsedBlock =
  | { type: "markdown"; content: string }
  | { type: "table"; table: ParsedTable };

function splitPipeRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((c) => c.trim());
}

function isTableSeparator(line: string): boolean {
  const cells = splitPipeRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function parseMarkdownWithTables(input: string): ParsedBlock[] {
  const lines = input.split("\n");
  const blocks: ParsedBlock[] = [];
  const markdownBuffer: string[] = [];

  const flushMarkdown = () => {
    const content = markdownBuffer.join("\n").trim();
    if (content.length > 0) {
      blocks.push({ type: "markdown", content });
    }
    markdownBuffer.length = 0;
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] || "";
    const next = lines[i + 1] || "";
    const startsTable = line.includes("|") && isTableSeparator(next);

    if (!startsTable) {
      markdownBuffer.push(line);
      i += 1;
      continue;
    }

    flushMarkdown();

    const headers = splitPipeRow(line);
    const rows: string[][] = [];
    i += 2; // skip header + separator

    while (i < lines.length) {
      const rowLine = lines[i] || "";
      if (!rowLine.trim() || !rowLine.includes("|")) break;
      rows.push(splitPipeRow(rowLine));
      i += 1;
    }

    blocks.push({ type: "table", table: { headers, rows } });
  }

  flushMarkdown();
  return blocks;
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
          {parseMarkdownWithTables(`## ${section.title}\n\n${section.content}`).map((block, idx) => {
            if (block.type === "markdown") {
              return (
                <ReactMarkdown key={`${section.id}-md-${idx}`}>
                  {block.content}
                </ReactMarkdown>
              );
            }

            return (
              <div key={`${section.id}-tbl-${idx}`} className="my-4 overflow-x-auto">
                <table className="w-full text-sm border border-[#2f2f2f] border-collapse">
                  <thead>
                    <tr className="bg-[#1b1b1b]">
                      {block.table.headers.map((header, hIdx) => (
                        <th
                          key={`${section.id}-h-${idx}-${hIdx}`}
                          className="px-3 py-2 border border-[#2f2f2f] text-left font-semibold text-neutral-200"
                        >
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.table.rows.map((row, rIdx) => (
                      <tr key={`${section.id}-r-${idx}-${rIdx}`} className={rIdx % 2 === 0 ? "bg-[#101010]" : "bg-[#151515]"}>
                        {row.map((cell, cIdx) => (
                          <td
                            key={`${section.id}-c-${idx}-${rIdx}-${cIdx}`}
                            className="px-3 py-2 border border-[#2f2f2f] text-neutral-300"
                          >
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
