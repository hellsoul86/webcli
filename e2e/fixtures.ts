import { expect, type Page } from "@playwright/test";

/**
 * Ensure at least one workspace exists and is selected.
 * Creates a workspace if none exist, otherwise clicks the first one.
 */
export async function ensureWorkspace(
  page: Page,
  name = "webcli-e2e",
): Promise<void> {
  const workspaceRows = page.locator('[data-testid^="workspace-row-"]');
  const threadOpenButton = page.getByTestId("thread-open-button");

  await page.waitForTimeout(250);

  if ((await workspaceRows.count()) === 0) {
    if (
      !(await page
        .getByTestId("workspace-name-input")
        .isVisible()
        .catch(() => false))
    ) {
      await page.getByTestId("workspace-create-button").click();
    }

    const workspacePath = process.cwd();
    const homePath = process.env.HOME ?? "";
    const workspaceDisplayPath = workspacePath.startsWith(homePath)
      ? `~${workspacePath.slice(homePath.length)}`
      : workspacePath;

    await page.getByTestId("workspace-name-input").fill(name);
    await page.getByTestId("workspace-path-input").fill(workspaceDisplayPath);
    await page.getByTestId("workspace-save-button").click();
    await expect(workspaceRows.first()).toBeVisible();
  } else {
    await workspaceRows.first().click();
  }

  await expect(threadOpenButton).toBeEnabled();
}

/**
 * Create a new thread and select it (desktop layout).
 * Clicks the thread-open button, waits for the new row, then clicks it.
 */
export async function ensureThread(page: Page): Promise<void> {
  const threadRows = page.locator('[data-testid^="thread-row-"]');
  const existingCount = await threadRows.count();
  await page.getByTestId("thread-open-button").click();
  await expect(threadRows).toHaveCount(existingCount + 1);
  await threadRows.first().click();
}

/**
 * Create a new thread on mobile layout.
 * On mobile, clicking thread-open-button auto-selects the thread and closes
 * the sidebar. We just wait for the composer to appear.
 */
export async function ensureThreadMobile(page: Page): Promise<void> {
  await page.getByTestId("thread-open-button").click();
  await expect(page.getByTestId("composer-input")).toBeVisible();
}

/**
 * Create a thread and send a message to trigger full connection establishment.
 * Useful for tests that need git snapshot or other data that loads after the
 * first turn completes.
 */
export async function ensureThreadWithMessage(page: Page): Promise<void> {
  await ensureThread(page);

  const prompt = `init-${Date.now()}`;
  await page.getByTestId("composer-input").fill(prompt);
  await page.getByTestId("send-button").click();
  await expect(
    page
      .getByTestId("timeline-list")
      .locator("article")
      .filter({ hasText: "READY" })
      .first(),
  ).toBeVisible();
}
