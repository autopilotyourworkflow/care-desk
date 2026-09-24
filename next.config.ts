import type { NextConfig } from "next";

// Static export: the app ships as plain files served by a Cloudflare Worker (static assets).
// The only server code is the /api/* handler in worker/index.ts.
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
