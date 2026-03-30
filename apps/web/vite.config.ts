import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const webPort = Number.parseInt(process.env.WEBCLI_WEB_PORT ?? "5173", 10);
const apiPort = Number.parseInt(process.env.WEBCLI_API_PORT ?? "4000", 10);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@webcli/contracts": resolve(
        __dirname,
        "../../packages/contracts/src/index.ts",
      ),
    },
  },
  server: {
    host: process.env.HOST ?? "127.0.0.1",
    port: webPort,
    proxy: {
      "/api": `http://127.0.0.1:${apiPort}`,
      "/ws": {
        target: `ws://127.0.0.1:${apiPort}`,
        ws: true,
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.ts",
    coverage: {
      provider: "v8",
      reportsDirectory: "../../output/coverage/web",
      reporter: ["text", "lcov", "json-summary"],
      include: ["src/**/*.ts", "src/**/*.tsx"],
      exclude: ["src/test/**"],
    },
  },
});
