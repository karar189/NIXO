import path from "node:path";
import type { NextConfig } from "next";

// The pnpm workspace root (nearHack/). Some API routes read repo-level data
// (fixtures/, checker/lists/) at runtime, so traces must start here.
const repoRoot = path.join(process.cwd(), "..");

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  outputFileTracingRoot: repoRoot,
  // Files read with fs at runtime. Serverless hosts (Vercel) ship only traced
  // files, so list them explicitly. Globs resolve from web/.
  outputFileTracingIncludes: {
    "/api/check": [
      "../fixtures/mainnet/*.json",
      "../checker/lists/*.txt",
      "./lib/checker/nixo_checker_preview.wasm",
    ],
    "/api/private-ai": ["../fixtures/samples/*.json"],
  },
  partialPrefetching: true,
  reactCompiler: true,
  // Old /trade URLs (from the NearArc merge) now live under /dashboard.
  async redirects() {
    return [
      { source: "/trade", destination: "/dashboard", permanent: false },
      { source: "/trade/agent", destination: "/dashboard/trade", permanent: false },
      { source: "/trade/settings", destination: "/dashboard/settings", permanent: false },
      { source: "/trade/about", destination: "/", permanent: false },
      // The docs are one continuous page; old per-chapter URLs land on their chapter.
      ...["deployments", "tracer", "vault", "solver", "trading", "copy-trading", "private-ai", "developers", "status"].map((chapter) => ({
        source: `/docs/${chapter}`,
        destination: `/docs#${chapter}`,
        permanent: false,
      })),
    ];
  },
  turbopack: {
    root: repoRoot,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
