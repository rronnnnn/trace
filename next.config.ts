import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Every page is per-user (auth cookies), so Cache Components' static shells buy little here.
  // Revisit when public pages (marketing, shared summaries) arrive.
  cacheComponents: false,
  turbopack: {
    root: path.resolve(__dirname),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
