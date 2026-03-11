import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@webcli/codex-protocol": resolve(
        __dirname,
        "../../packages/codex-protocol/src/index.ts",
      ),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:4000",
      "/ws": {
        target: "ws://127.0.0.1:4000",
        ws: true,
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.ts",
  },
});
