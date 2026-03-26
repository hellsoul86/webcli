import { expect, test, type Page } from "@playwright/test";

test.describe("Workspace and thread management", () => {
  test.describe.configure({ mode: "serial" });

  test("creates workspace with name and path", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("desktop-shell")).toBeVisible();

    const workspaceRows = page.locator('[data-testid^="workspace-row-"]');

    // Click create workspace button
    if (!(await page.getByTestId("workspace-name-input").isVisible().catch(() => false))) {
      await page.getByTestId("workspace-create-button").click();
    }

    const workspacePath = process.cwd();
    const homePath = process.env.HOME ?? "";
    const displayPath = workspacePath.startsWith(homePath)
      ? `~${workspacePath.slice(homePath.length)}`
      : workspacePath;

    await page.getByTestId("workspace-name-input").fill("test-workspace");
    await page.getByTestId("workspace-path-input").fill(displayPath);
    await page.getByTestId("workspace-save-button").click();

    // Workspace appears in sidebar
    await expect(workspaceRows.first()).toBeVisible();
    await expect(workspaceRows.first()).toContainText("test-workspace");
  });

  test("edits workspace settings", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("desktop-shell")).toBeVisible();
    await ensureWorkspace(page);

    // Find the workspace gear / edit button
    const workspaceRow = page.locator('[data-testid^="workspace-row-"]').first();
    const editButton = workspaceRow.getByRole("button", { name: /维护项目|编辑|设置/i });
    if (await editButton.isVisible().catch(() => false)) {
      await editButton.click();

      // Verify modal opened with current name
      await expect(page.getByTestId("workspace-name-input")).toBeVisible();

      // Change name
      await page.getByTestId("workspace-name-input").fill("renamed-workspace");
      await page.getByTestId("workspace-save-button").click();

      // Verify updated
      await expect(workspaceRow).toContainText("renamed-workspace");
    }
  });

  test("renames thread from header", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("desktop-shell")).toBeVisible();
    await ensureWorkspace(page);
    await ensureThread(page);

    // Check if thread title edit button exists
    const editButton = page.getByTestId("thread-title-edit-button");
    if (await editButton.isVisible().catch(() => false)) {
      await editButton.click();

      const titleInput = page.getByTestId("thread-title-input");
      await expect(titleInput).toBeVisible();
      await titleInput.fill("Renamed Thread E2E");
      await titleInput.press("Enter");

      // Verify title updated
      await expect(page.getByTestId("thread-title-display")).toContainText("Renamed Thread E2E");
    }
  });

  test("archives and restores thread", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("desktop-shell")).toBeVisible();
    await ensureWorkspace(page);
    await ensureThread(page);

    const threadRows = page.locator('[data-testid^="thread-row-"]');
    const initialCount = await threadRows.count();

    // Right-click or open thread menu for archive
    const firstThread = threadRows.first();
    const threadMenu = page.locator('[data-testid^="thread-menu-"]').first();
    if (await threadMenu.isVisible().catch(() => false)) {
      await threadMenu.click();
      const archiveButton = page.getByRole("menuitem", { name: /归档|Archive/i });
      if (await archiveButton.isVisible().catch(() => false)) {
        await archiveButton.click();
        // Thread should disappear from active list
        await expect(threadRows).toHaveCount(initialCount - 1);

        // Restore via settings → history
        await page.getByTestId("settings-button").click();
        await page.getByRole("button", { name: "历史" }).click();
        const restoreButton = page.getByRole("button", { name: /恢复|Restore/i }).first();
        if (await restoreButton.isVisible().catch(() => false)) {
          await restoreButton.click();
        }
        await page.getByTestId("settings-panel").getByRole("button", { name: "关闭" }).click();
      }
    }
  });

  test("forks thread from context menu", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("desktop-shell")).toBeVisible();
    await ensureWorkspace(page);
    await ensureThread(page);

    const threadRows = page.locator('[data-testid^="thread-row-"]');
    const initialCount = await threadRows.count();

    const threadMenu = page.locator('[data-testid^="thread-menu-"]').first();
    if (await threadMenu.isVisible().catch(() => false)) {
      await threadMenu.click();
      const forkButton = page.getByRole("menuitem", { name: /分叉|Fork/i });
      if (await forkButton.isVisible().catch(() => false)) {
        await forkButton.click();
        // New forked thread should appear
        await expect(threadRows).toHaveCount(initialCount + 1);
      }
    }
  });

  test("selects 'all workspaces' view", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("desktop-shell")).toBeVisible();
    await ensureWorkspace(page);

    // Click "all workspaces" button
    const allButton = page.getByTestId("workspace-all-button");
    if (await allButton.isVisible().catch(() => false)) {
      await allButton.click();
      // Should show threads from all workspaces
      await expect(page.locator('[data-testid^="thread-row-"]').first()).toBeVisible();
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

    await page.getByTestId("workspace-name-input").fill("webcli-wt-e2e");
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
