import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FilingLens — AI-powered SEC Filing Analysis",
  description: "Analyze SEC filings with AI. Get professional financial reports from public EDGAR data.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased min-h-screen bg-[#0a0a0a]">
        {children}
      </body>
    </html>
  );
}
