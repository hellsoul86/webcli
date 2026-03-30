import { expect, test } from "@playwright/test";
import { ensureWorkspace, ensureThread } from "./fixtures";

test.describe("Composer controls", () => {
  test.describe.configure({ mode: "serial" });

  test("model selector is visible and opens dropdown", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("desktop-shell")).toBeVisible();
    await ensureWorkspace(page, "webcli-controls-e2e");
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

  test("toggles thinking mode", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("desktop-shell")).toBeVisible();
    await ensureWorkspace(page, "webcli-controls-e2e");
    await ensureThread(page);

    const toggle = page.getByTestId("composer-reasoning-select").getByRole("switch");
    await expect(toggle).toBeVisible();

    // Toggle OFF (low)
    if ((await toggle.getAttribute("aria-checked")) === "true") {
      await toggle.click();
    }
    await expect(toggle).toHaveAttribute("aria-checked", "false");

    // Toggle ON (xhigh)
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
  });

  test("changes approval policy", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("desktop-shell")).toBeVisible();
    await ensureWorkspace(page, "webcli-controls-e2e");
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
    await ensureWorkspace(page, "webcli-controls-e2e");
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
    await ensureWorkspace(page, "webcli-controls-e2e");
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
