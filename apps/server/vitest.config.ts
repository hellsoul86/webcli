import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@webcli/contracts": resolve(__dirname, "../../packages/contracts/src/index.ts"),
      "@webcli/core": resolve(__dirname, "../../packages/core/src/index.ts"),
      "@webcli/runtime-codex": resolve(
        __dirname,
        "../../packages/runtime-codex/src/index.ts",
      ),
    },
  },
  test: {
    environment: "node",
    coverage: {
      provider: "v8",
      reportsDirectory: "../../output/coverage/server",
      reporter: ["text", "lcov", "json-summary"],
      include: ["src/**/*.ts"],
      exclude: ["src/fake-runtime.ts"],
    },
  },
});
