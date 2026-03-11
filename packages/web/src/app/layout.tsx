import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dolph | SEC EDGAR Research Console",
  description: "Institutional-grade SEC filing analysis, company comparison, and disclosure search built on Dolph’s deterministic finance engine.",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "any" },
    ],
    shortcut: "/favicon.ico",
    apple: "/dolph-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-background font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
