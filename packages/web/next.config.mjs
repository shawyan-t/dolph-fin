import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const serverPackages = [
  "dolph-fin",
  "@shawyan/shared",
  "@shawyan/mcp-sec-server",
  "@shawyan/mcp-financials-server",
  "openai",
  "cheerio",
  "puppeteer",
  "puppeteer-core",
  "@sparticuz/chromium",
  "ws",
  "bufferutil",
  "utf-8-validate",
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: serverPackages,
    outputFileTracingRoot: path.join(__dirname, "../../"),
    outputFileTracingIncludes: {
      "/api/analyze": [
        "../../node_modules/@sparticuz/chromium/**/*",
        "../../node_modules/.pnpm/@sparticuz+chromium@*/node_modules/@sparticuz/chromium/**/*",
      ],
      "/api/analyze/route": [
        "../../node_modules/@sparticuz/chromium/**/*",
        "../../node_modules/.pnpm/@sparticuz+chromium@*/node_modules/@sparticuz/chromium/**/*",
      ],
    },
  },
};

export default nextConfig;
