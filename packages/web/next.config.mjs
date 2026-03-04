/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow importing from monorepo packages
  transpilePackages: [
    "@dolph/shared",
    "@dolph/agent",
    "@dolph/mcp-sec-server",
    "@dolph/mcp-financials-server",
  ],
  // Enable server actions for SSE streaming
  experimental: {
    serverComponentsExternalPackages: [
      "openai",
      "cheerio",
    ],
  },
};

export default nextConfig;
