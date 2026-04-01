import { expect, test } from "@playwright/test";
import { ensureWorkspace, ensureThread, ensureThreadWithMessage, ensureThreadMobile } from "./fixtures";

/**
 * Visual regression tests — capture screenshots of core screens and compare
 * against committed baselines. On first run, baselines are generated.
 *
 * These tests are skipped in CI by default because font rendering differs
 * between macOS and Linux. Run locally with:
 *   npx playwright test e2e/visual-regression.spec.ts
 *
 * To regenerate baselines after intentional visual changes:
 *   npx playwright test e2e/visual-regression.spec.ts --update-snapshots
 */

const SKIP_IN_CI = !!process.env.CI;

test.describe("Visual regression — desktop", () => {
  test.skip(SKIP_IN_CI, "Visual regression runs locally only — font rendering differs on CI");
  test.describe.configure({ mode: "serial" });

  test("empty workspace state", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("desktop-shell")).toBeVisible();
    await ensureWorkspace(page, "webcli-visual");

    await expect(page).toHaveScreenshot("desktop-empty-workspace.png", {
      maxDiffPixelRatio: 0.01,
    });
  });

  test("conversation with response", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("desktop-shell")).toBeVisible();
    await ensureWorkspace(page, "webcli-visual");
    await ensureThread(page);

    const prompt = "visual-test";
    await page.getByTestId("composer-input").fill(prompt);
    await page.getByTestId("send-button").click();

    await expect(
      page.getByTestId("timeline-list").locator("article").filter({ hasText: "READY" }).first(),
    ).toBeVisible();

    // Wait for streaming to settle
    await page.waitForTimeout(300);

    await expect(page).toHaveScreenshot("desktop-conversation.png", {
      maxDiffPixelRatio: 0.01,
    });
  });

  test("git review panel open", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("desktop-shell")).toBeVisible();
    await ensureWorkspace(page, "webcli-visual");
    await ensureThreadWithMessage(page);

    await expect(page.getByTestId("git-workbench-open-button")).toBeEnabled();
    await page.getByTestId("git-workbench-open-button").click();
    await expect(page.getByTestId("git-workbench")).toBeVisible();

    // Wait for diff to render
    await page.waitForTimeout(500);

    await expect(page).toHaveScreenshot("desktop-git-review.png", {
      maxDiffPixelRatio: 0.01,
    });
  });

  test("settings panel — defaults tab", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("desktop-shell")).toBeVisible();
    await ensureWorkspace(page, "webcli-visual");
    await ensureThread(page);

    await page.getByTestId("settings-button").click();
    await expect(page.getByTestId("settings-panel")).toBeVisible();

    // Navigate to defaults tab
    await page.getByRole("button", { name: "默认代理" }).click();
    await expect(page.getByTestId("settings-model-input")).toBeVisible();

    await expect(page).toHaveScreenshot("desktop-settings-defaults.png", {
      maxDiffPixelRatio: 0.01,
    });
  });
});

test.describe("Visual regression — mobile", () => {
  test.skip(SKIP_IN_CI, "Visual regression runs locally only — font rendering differs on CI");
  test.describe.configure({ mode: "serial" });
  test.use({ viewport: { width: 375, height: 812 } });

  test("mobile conversation", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("desktop-shell")).toBeVisible();
    await ensureWorkspace(page, "webcli-visual-mobile");
    await ensureThreadMobile(page);

    const prompt = "mobile-visual-test";
    await page.getByTestId("composer-input").fill(prompt);
    await page.getByTestId("send-button").click();

    await expect(
      page.getByTestId("timeline-list").locator("article").filter({ hasText: "READY" }).first(),
    ).toBeVisible();

    await page.waitForTimeout(300);

    await expect(page).toHaveScreenshot("mobile-conversation.png", {
      maxDiffPixelRatio: 0.01,
    });
  });
});
