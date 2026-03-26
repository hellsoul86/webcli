import { expect, test, type Page } from "@playwright/test";

test.describe("Conversation core", () => {
  test.describe.configure({ mode: "serial" });

  test("creates new thread from sidebar", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("desktop-shell")).toBeVisible();
    await ensureWorkspace(page);

    const threadRows = page.locator('[data-testid^="thread-row-"]');
    const initialCount = await threadRows.count();

    // Click new thread button
    await page.getByTestId("thread-open-button").click();
    await expect(threadRows).toHaveCount(initialCount + 1);

    // Composer should be focused / visible
    await expect(page.getByTestId("composer-input")).toBeVisible();
  });

  test("switches between threads preserves messages", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("desktop-shell")).toBeVisible();
    await ensureWorkspace(page);

    // Create thread A and send a message
    await ensureThread(page);
    const timeline = page.getByTestId("timeline-list");

    const promptA = `thread-A-${Date.now()}`;
    await page.getByTestId("composer-input").fill(promptA);
    await page.getByTestId("send-button").click();

    // Wait for reply before switching
    await expect(
      timeline.locator("article").filter({ hasText: "READY" }).first(),
    ).toBeVisible();

    // Create thread B
    await ensureThread(page);

    const promptB = `thread-B-${Date.now()}`;
    await page.getByTestId("composer-input").fill(promptB);
    await page.getByTestId("send-button").click();

    // Wait for reply
    await expect(
      timeline.locator("article").filter({ hasText: promptB }).first(),
    ).toBeVisible();

    // Switch back to thread A (now second in sidebar list)
    const threadRows = page.locator('[data-testid^="thread-row-"]');
    await threadRows.nth(1).click();
    await expect(
      timeline.locator("article").filter({ hasText: promptA }).first(),
    ).toBeVisible();
  });

  test("sends message and receives streaming response", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("desktop-shell")).toBeVisible();
    await ensureWorkspace(page);
    await ensureThread(page);

    const prompt = `stream-verify-${Date.now()}`;
    await page.getByTestId("composer-input").fill(prompt);
    await page.getByTestId("send-button").click();

    const timeline = page.getByTestId("timeline-list");

    // User message appears
    await expect(
      timeline.locator("article").filter({ hasText: prompt }).first(),
    ).toBeVisible();

    // Streaming response appears (partial "RE" then full "READY")
    await expect.poll(async () => {
      const texts = await timeline.locator("article").allTextContents();
      return texts.some((text) => text.includes("READY"));
    }).toBe(true);
  });

  test("shows plan card with steps", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("desktop-shell")).toBeVisible();
    await ensureWorkspace(page);
    await ensureThread(page);

    const prompt = `plan-test-${Date.now()}`;
    await page.getByTestId("composer-input").fill(prompt);
    await page.getByTestId("send-button").click();

    // Plan card should appear
    await expect(page.getByTestId("composer-plan")).toBeVisible();
    await expect(page.getByTestId("composer-plan")).toContainText(
      "Fake runtime execution plan",
    );
  });

  test("thread title shows in header", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("desktop-shell")).toBeVisible();
    await ensureWorkspace(page);
    await ensureThread(page);

    // Thread summary/title should be visible in header area
    await expect(page.getByTestId("thread-summary-display")).toBeVisible();
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

    await page.getByTestId("workspace-name-input").fill("webcli-conv-e2e");
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
