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
  },
};

export default nextConfig;
