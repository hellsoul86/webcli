import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { defineConfig } from "@playwright/test";

const webPort = 45173;
const apiPort = 45100;
const e2eDataDir = mkdtempSync(join(tmpdir(), "webcli-e2e-"));
const baseURL = `http://127.0.0.1:${webPort}`;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "output/playwright",
  timeout: 120_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: [
      "HOST=127.0.0.1",
      `PORT=${apiPort}`,
      "WEBCLI_FAKE_RUNTIME=1",
      "WEBCLI_FAKE_EXTERNAL_THREAD_CWD=/srv/webcli-staging/repo",
      `WEBCLI_DATA_DIR=${e2eDataDir}`,
      `WEBCLI_WEB_PORT=${webPort}`,
      `WEBCLI_API_PORT=${apiPort}`,
      "npm run dev",
    ].join(" "),
    url: baseURL,
    timeout: 120_000,
    reuseExistingServer: false,
  },
});
