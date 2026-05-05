import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Spotify rejects http://localhost as an OAuth redirect URI (2024 policy),
  // so we run the dev server at http://127.0.0.1:3000 — Next.js 16 blocks
  // cross-origin /_next/* (HMR, bundles) by default, breaking hydration.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
