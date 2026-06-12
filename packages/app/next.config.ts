import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { securityHeaders } from "./lib/security/headers";

// next.config.ts runs as an ES module; reconstruct __dirname from import.meta.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const nextConfig: NextConfig = {
  typedRoutes: true,
  // Pin the monorepo root so Next uses the correct workspace root when tracing
  // serverless function files. Without this, a stray ~/package-lock.json (or
  // any lockfile outside the pnpm workspace) causes Next to infer the wrong
  // root and mis-trace output files. (Audit M7)
  //
  // Vercel checks out a clean repo (no stray lockfiles) and resolves the
  // manifest path relative to its own build root — setting this on Vercel
  // doubles the path (`/vercel/path0/vercel/path0/.next/...`) and the build
  // can't find routes-manifest.json. So only apply locally.
  ...(process.env.VERCEL ? {} : { outputFileTracingRoot: path.join(__dirname, "../../") }),
  async headers() {
    return [
      {
        // Apply security headers to every route (app + API).
        source: "/:path*",
        headers: securityHeaders(),
      },
    ];
  },
  webpack(config) {
    // wagmi v3 / @base-org connectors reference an optional "accounts" package
    // that is not installed. Provide an empty stub so the build doesn't fail.
    config.resolve.alias = {
      ...config.resolve.alias,
      accounts: false,
    };
    return config;
  },
};

export default nextConfig;
