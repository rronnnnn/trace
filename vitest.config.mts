import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  // tsconfig uses jsx: preserve for Next; tests need the automatic runtime.
  oxc: { jsx: { runtime: "automatic" } },
  test: { include: ["src/**/*.test.{ts,tsx}"], environment: "node" },
});
