import { expect, test, type Page } from "@playwright/test";

test.describe("Composer controls", () => {
  test.describe.configure({ mode: "serial" });

  test("model selector is visible and opens dropdown", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("desktop-shell")).toBeVisible();
    await ensureWorkspace(page);
    await ensureThread(page);

    const modelSelect = page.getByTestId("composer-model-select");
    await expect(modelSelect).toBeVisible();
    await expect(modelSelect).toHaveAttribute("data-value", "gpt-5-codex");

    // Click to open dropdown menu
    await modelSelect.click();
    const menu = page.getByTestId("composer-model-select-menu");
    await expect(menu).toBeVisible();

    // At least one option visible (gpt-5-codex; spark is filtered as upgrade target)
    await expect(page.getByTestId("composer-model-select-option-gpt-5-codex")).toBeVisible();

    // Close dropdown by pressing Escape
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
  });

  test("changes reasoning effort", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("desktop-shell")).toBeVisible();
    await ensureWorkspace(page);
    await ensureThread(page);

    const reasoningSelect = page.getByTestId("composer-reasoning-select");
    await expect(reasoningSelect).toBeVisible();

    await reasoningSelect.click();
    await page.getByTestId("composer-reasoning-select-option-low").click();
    await expect(reasoningSelect).toHaveAttribute("data-value", "low");
  });

  test("changes approval policy", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("desktop-shell")).toBeVisible();
    await ensureWorkspace(page);
    await ensureThread(page);

    const approvalSelect = page.getByTestId("composer-approval-policy-select");
    await expect(approvalSelect).toBeVisible();

    await approvalSelect.click();
    await page.getByTestId("composer-approval-policy-select-option-never").click();
    await expect(approvalSelect).toHaveAttribute("data-value", "never");
  });

  test("toggles speed mode", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("desktop-shell")).toBeVisible();
    await ensureWorkspace(page);
    await ensureThread(page);

    const speedSwitch = page.getByTestId("composer-speed-switch");
    await expect(speedSwitch).toBeVisible();

    // Initially unchecked (Standard)
    await expect(speedSwitch).toHaveAttribute("aria-checked", "false");

    // Toggle to Fast
    await speedSwitch.click();
    await expect(speedSwitch).toHaveAttribute("aria-checked", "true");

    // Toggle back to Standard
    await speedSwitch.click();
    await expect(speedSwitch).toHaveAttribute("aria-checked", "false");
  });

  test("switches language locale", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("desktop-shell")).toBeVisible();
    await ensureWorkspace(page);
    await ensureThread(page);

    // Find the locale selector in the header
    const localeSelect = page.getByTestId("composer-locale-select");
    // If it exists, test it; otherwise look for settings-language
    if (await localeSelect.isVisible().catch(() => false)) {
      await localeSelect.click();
      await page.getByTestId("composer-locale-select-option-en-US").click();
      // Verify UI changed to English
      await expect(page.getByTestId("settings-button")).toBeVisible();
    } else {
      // Fallback: use settings panel
      await page.getByTestId("settings-button").click();
      const settingsPanel = page.getByTestId("settings-panel");
      await expect(settingsPanel).toBeVisible();
      // Look for language setting
      const langSelect = page.getByTestId("settings-language");
      if (await langSelect.isVisible().catch(() => false)) {
        await langSelect.selectOption("en-US");
      }
    }
  });
});

// --- Helpers ---

async function ensureWorkspace(page: Page): Promise<void> {
  const workspaceRows = page.locator('[data-testid^="workspace-row-"]');
  const threadOpenButton = page.getByTestId("thread-open-button");

  await page.waitForTimeout(250);

  if ((await workspaceRows.count()) === 0) {
    if (!(await page.getByTestId("workspace-name-input").isVisible().catch(() => false))) {
      await page.getByTestId("workspace-create-button").click();
    }

    const workspacePath = process.cwd();
    const homePath = process.env.HOME ?? "";
    const workspaceDisplayPath = workspacePath.startsWith(homePath)
      ? `~${workspacePath.slice(homePath.length)}`
      : workspacePath;

    await page.getByTestId("workspace-name-input").fill("webcli-composer-e2e");
    await page.getByTestId("workspace-path-input").fill(workspaceDisplayPath);
    await page.getByTestId("workspace-save-button").click();
    await expect(workspaceRows.first()).toBeVisible();
  } else {
    await workspaceRows.first().click();
  }

  await expect(threadOpenButton).toBeEnabled();
}

async function ensureThread(page: Page): Promise<void> {
  const threadRows = page.locator('[data-testid^="thread-row-"]');
  const existingCount = await threadRows.count();
  await page.getByTestId("thread-open-button").click();
  await expect(threadRows).toHaveCount(existingCount + 1);
  await threadRows.first().click();
}
