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
  },
});
