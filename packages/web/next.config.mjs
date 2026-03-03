/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow importing from monorepo packages
  transpilePackages: [
    "@filinglens/shared",
    "@filinglens/agent",
    "@filinglens/mcp-sec-server",
    "@filinglens/mcp-financials-server",
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
