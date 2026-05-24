import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Production builds emit `.next/standalone/` containing a self-contained
  // server bundle. The Fly Dockerfile copies just .next/standalone, .next/static,
  // and public/ — drops the runtime image from ~500MB to ~150MB.
  output: "standalone",

  // Spotify rejects http://localhost as an OAuth redirect URI (2024 policy),
  // so we canonicalize on http://127.0.0.1:3000. Next.js 16 blocks cross-origin
  // /_next/* (HMR, bundles) by default, which breaks hydration on any host
  // other than the one the dev server was started with.
  //
  // The dev server binds to 0.0.0.0 (see package.json `dev` script) so
  // phones / other devices on the LAN can reach it. List every host you
  // expect to access the app from. Add your machine's LAN IP here if it
  // differs (find it with `ipconfig getifaddr en0` on macOS).
  allowedDevOrigins: [
    "127.0.0.1",
    "localhost",
    "192.168.4.82",
  ],
};

export default nextConfig;
