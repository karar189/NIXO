import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
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
      ...["tracer", "vault", "solver", "trading", "private-ai", "developers", "status"].map((chapter) => ({
        source: `/docs/${chapter}`,
        destination: `/docs#${chapter}`,
        permanent: false,
      })),
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
