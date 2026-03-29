import { expect, test, type Page } from "@playwright/test";

test.describe("Git workbench", () => {
  test.describe.configure({ mode: "serial" });

  test("shows git status in composer bar", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("desktop-shell")).toBeVisible();
    await ensureWorkspace(page);
    await ensureThreadWithMessage(page);

    // Wait for git snapshot to load (review button becomes enabled)
    await expect(page.getByTestId("git-workbench-open-button")).toBeEnabled();

    // Git summary bar should show file count and stats
    const gitBar = page.getByTestId("git-summary-bar");
    await expect(gitBar).toBeVisible();

    // Should display additions and deletions
    await expect(gitBar.locator(".window-stat--positive")).toBeVisible();
    await expect(gitBar.locator(".window-stat--negative")).toBeVisible();

    // Branch selector should appear once the git snapshot loads
    await expect(page.getByTestId("composer-git-branch-select")).toBeVisible();
  });

  test("opens review panel with grouped file tree", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("desktop-shell")).toBeVisible();
    await ensureWorkspace(page);
    await ensureThreadWithMessage(page);

    // Open the git review panel
    await page.getByTestId("git-workbench-open-button").click();
    await expect(page.getByTestId("git-workbench")).toBeVisible();

    const fileTree = page.getByTestId("git-file-tree");
    await expect(fileTree).toBeVisible();

    // Should show file groups — fake runtime generates unstaged and staged-unstaged files
    // At minimum, unstaged group should be present (README.md is unstaged-only)
    await expect(page.getByTestId("git-review-group-unstaged")).toBeVisible();

    // Conflicted group should also be present (docs/review/notes.md)
    await expect(page.getByTestId("git-review-group-conflicted")).toBeVisible();
  });

  test("selects file and shows diff viewer", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("desktop-shell")).toBeVisible();
    await ensureWorkspace(page);
    await ensureThreadWithMessage(page);

    await page.getByTestId("git-workbench-open-button").click();
    await expect(page.getByTestId("git-workbench")).toBeVisible();

    // Click README.md in the unstaged group
    const unstagedGroup = page.getByTestId("git-review-group-unstaged");
    await unstagedGroup
      .getByRole("button", { name: /README\.md/i })
      .evaluate((node) => (node as HTMLButtonElement).click());

    // Path should display above the diff
    await expect(page.getByTestId("git-review-path")).toContainText("README.md");

    // Diff viewer should be rendered (Monaco diff editor)
    await expect(page.getByTestId("git-review-diff-viewer")).toBeVisible();
  });

  test("branch selector shows current branch and opens menu", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("desktop-shell")).toBeVisible();
    await ensureWorkspace(page);
    await ensureThreadWithMessage(page);

    // Wait for git snapshot to load
    await expect(page.getByTestId("git-workbench-open-button")).toBeEnabled();

    // Branch selector should show current branch (main)
    const branchSelect = page.getByTestId("composer-git-branch-select");
    await expect(branchSelect).toBeVisible();
    await expect(branchSelect).toHaveAttribute("data-value", "main");

    // Clicking opens a dropdown menu
    await branchSelect.click();
    const menu = page.getByTestId("composer-git-branch-select-menu");
    await expect(menu).toBeVisible();

    // Current branch should appear as selected in the menu
    const mainOption = menu.getByRole("menuitemradio", { name: "main" });
    await expect(mainOption).toHaveAttribute("aria-checked", "true");

    // Close menu by pressing Escape
    await page.keyboard.press("Escape");
    await expect(menu).not.toBeVisible();
  });

  test("closes review panel and returns to conversation", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("desktop-shell")).toBeVisible();
    await ensureWorkspace(page);
    await ensureThreadWithMessage(page);

    // Open the review panel
    await page.getByTestId("git-workbench-open-button").click();
    await expect(page.getByTestId("git-workbench")).toBeVisible();

    // Click back button (text: 返回会话)
    await page.getByRole("button", { name: "返回会话" }).click();

    // Review panel should close
    await expect(page.getByTestId("git-workbench")).not.toBeVisible();

    // Conversation should be visible again
    await expect(page.getByTestId("composer-input")).toBeVisible();
  });
});

// --- Helpers ---

async function ensureWorkspace(page: Page): Promise<void> {
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

    await page.getByTestId("workspace-name-input").fill("webcli-git-e2e");
    await page.getByTestId("workspace-path-input").fill(workspaceDisplayPath);
    await page.getByTestId("workspace-save-button").click();
    await expect(workspaceRows.first()).toBeVisible();
  } else {
    await workspaceRows.first().click();
  }

  await expect(threadOpenButton).toBeEnabled();
}

async function ensureThreadWithMessage(page: Page): Promise<void> {
  const threadRows = page.locator('[data-testid^="thread-row-"]');
  const existingCount = await threadRows.count();
  await page.getByTestId("thread-open-button").click();
  await expect(threadRows).toHaveCount(existingCount + 1);
  await threadRows.first().click();

  // Send a message to trigger full connection establishment + git snapshot load
  const prompt = `git-init-${Date.now()}`;
  await page.getByTestId("composer-input").fill(prompt);
  await page.getByTestId("send-button").click();
  await expect(
    page.getByTestId("timeline-list").locator("article").filter({ hasText: "READY" }).first(),
  ).toBeVisible();
}
