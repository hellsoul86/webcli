import { expect, test } from "@playwright/test";
import { ensureWorkspace, ensureThread } from "./fixtures";

test.describe("Settings and error handling", () => {
  test.describe.configure({ mode: "serial" });

  test("opens settings overlay and navigates tabs", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("desktop-shell")).toBeVisible();
    await ensureWorkspace(page, "webcli-settings-e2e");
    await ensureThread(page);

    await page.getByTestId("settings-button").click();
    const settingsPanel = page.getByTestId("settings-panel");
    await expect(settingsPanel).toBeVisible();

    // Navigate all tabs
    const tabs = ["账号", "默认代理", "集成", "扩展", "历史"];
    for (const tab of tabs) {
      await settingsPanel.getByRole("button", { name: tab }).click();
      await page.waitForTimeout(100);
    }

    // Close settings
    await settingsPanel.getByRole("button", { name: "关闭" }).click();
    await expect(settingsPanel).toHaveCount(0);
  });

  test("settings account tab shows auth info", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("desktop-shell")).toBeVisible();
    await ensureWorkspace(page, "webcli-settings-e2e");
    await ensureThread(page);

    await page.getByTestId("settings-button").click();
    const settingsPanel = page.getByTestId("settings-panel");
    await settingsPanel.getByRole("button", { name: "账号" }).click();

    // Should show fake runtime account info
    await expect(settingsPanel).toContainText("fake-runtime@example.com");
    await settingsPanel.getByRole("button", { name: "关闭" }).click();
  });

  test("settings defaults tab persists model config", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("desktop-shell")).toBeVisible();
    await ensureWorkspace(page, "webcli-settings-e2e");
    await ensureThread(page);

    await page.getByTestId("settings-button").click();
    const settingsPanel = page.getByTestId("settings-panel");
    await settingsPanel.getByRole("button", { name: "默认代理" }).click();

    // Model input should have fake runtime default
    await expect(page.getByTestId("settings-model-input")).toHaveValue("gpt-5-codex");

    // Change and save
    await page.getByTestId("settings-model-input").fill("gpt-5-codex-spark");
    await page.getByTestId("settings-save-button").click();

    // Reload and verify persisted
    await page.reload();
    await expect(page.getByTestId("desktop-shell")).toBeVisible();
    await page.getByTestId("settings-button").click();
    await page.getByRole("button", { name: "默认代理" }).click();
    await expect(page.getByTestId("settings-model-input")).toHaveValue("gpt-5-codex-spark");

    // Restore original value so other tests are not affected
    await page.getByTestId("settings-model-input").fill("gpt-5-codex");
    await page.getByTestId("settings-save-button").click();

    await page.getByTestId("settings-panel").getByRole("button", { name: "关闭" }).click();
  });

  test("settings integrations tab shows MCP servers", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("desktop-shell")).toBeVisible();
    await ensureWorkspace(page, "webcli-settings-e2e");
    await ensureThread(page);

    await page.getByTestId("settings-button").click();
    const settingsPanel = page.getByTestId("settings-panel");
    await settingsPanel.getByRole("button", { name: "集成" }).click();
    await expect(settingsPanel).toContainText("MCP Servers");
    await settingsPanel.getByRole("button", { name: "关闭" }).click();
  });

  test("settings extensions tab shows skills and plugins", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("desktop-shell")).toBeVisible();
    await ensureWorkspace(page, "webcli-settings-e2e");
    await ensureThread(page);

    await page.getByTestId("settings-button").click();
    const settingsPanel = page.getByTestId("settings-panel");
    await settingsPanel.getByRole("button", { name: "扩展" }).click();

    await expect(settingsPanel).toContainText("技能");
    await expect(settingsPanel).toContainText("插件");
    await settingsPanel.getByRole("button", { name: "关闭" }).click();
  });

  test("settings history tab shows archived threads", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("desktop-shell")).toBeVisible();
    await ensureWorkspace(page, "webcli-settings-e2e");
    await ensureThread(page);

    await page.getByTestId("settings-button").click();
    const settingsPanel = page.getByTestId("settings-panel");
    await settingsPanel.getByRole("button", { name: "历史" }).click();
    await expect(settingsPanel).toContainText("归档线程");
    await settingsPanel.getByRole("button", { name: "关闭" }).click();
  });

  test("no console errors during normal interaction", async ({ page }) => {
    const consoleErrors: Array<string> = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });

    await page.goto("/");
    await expect(page.getByTestId("desktop-shell")).toBeVisible();
    await ensureWorkspace(page, "webcli-settings-e2e");
    await ensureThread(page);

    // Send a message
    await page.getByTestId("composer-input").fill(`health-check-${Date.now()}`);
    await page.getByTestId("send-button").click();

    const timeline = page.getByTestId("timeline-list");
    await expect(
      timeline.locator("article").filter({ hasText: "READY" }).first(),
    ).toBeVisible();

    // Open and close settings
    await page.getByTestId("settings-button").click();
    await expect(page.getByTestId("settings-panel")).toBeVisible();
    await page.getByTestId("settings-panel").getByRole("button", { name: "关闭" }).click();

    expect(consoleErrors).toEqual([]);
  });
});
