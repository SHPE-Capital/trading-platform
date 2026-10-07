import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The repository root has its own package-lock for local-stack tooling.
  // Keep Turbopack scoped to the actual Next.js application.
  turbopack: { root: process.cwd() },
};

export default nextConfig;
