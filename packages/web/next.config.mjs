const serverPackages = [
  "@dolph/agent",
  "@dolph/shared",
  "@dolph/mcp-sec-server",
  "@dolph/mcp-financials-server",
  "openai",
  "cheerio",
  "puppeteer",
  "puppeteer-core",
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
