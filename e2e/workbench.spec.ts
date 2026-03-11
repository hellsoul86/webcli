import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });

test("creates a workspace, opens a thread, replays approvals after reload, and shows review output", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.getByTestId("desktop-shell")).toBeVisible();
  await expect(page.getByText("fake-runtime@example.com")).toBeVisible();

  await ensureWorkspace(page);
  await ensureThread(page);

  const prompt = `Reply with READY ${Date.now()}`;
  await page.getByTestId("composer-input").fill(prompt);
  await page.getByTestId("send-button").click();

  const timeline = page.getByTestId("timeline-list");
  await expect(timeline.locator("article").filter({ hasText: prompt }).first()).toBeVisible();
  await expect(timeline.locator("article").filter({ hasText: "READY" }).first()).toBeVisible();
  await expect(timeline.getByRole("button", { name: /思考过程/ }).first()).toBeVisible();
  await expect(timeline.getByText("检查当前 workspace 状态。")).toHaveCount(0);
  await timeline.getByRole("button", { name: /思考过程/ }).first().click();
  await expect(timeline.getByText("检查当前 workspace 状态。")).toBeVisible();
  await page.waitForTimeout(500);
  await expect(timeline.locator("article").filter({ hasText: "READY" }).first()).toBeVisible();
  await expect(page.getByTestId("composer-plan")).toContainText("Fake runtime execution plan");
  await expect(page.getByTestId("composer-plan")).toContainText("Inspect bootstrap data");

  await page.getByTestId("inspector-tab-diff").click();
  await expect(page.getByTestId("diff-output")).toContainText("Handled prompt");

  await page.getByTestId("inspector-tab-plan").click();
  await expect(page.getByTestId("plan-output")).toContainText("Fake runtime execution plan");

  const approvalCard = page.locator('[data-testid^="approval-card-"]').first();
  await expect(approvalCard).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("desktop-shell")).toBeVisible();
  await expect(page.locator('[data-testid^="approval-card-"]').first()).toBeVisible();
  await page.locator('[data-testid^="approval-card-"]').first().getByRole("button", { name: "接受" }).click();
  await expect(page.locator('[data-testid^="approval-card-"]')).toHaveCount(0);

  await page.getByTestId("review-button").click();
  await expect(page.getByTestId("review-output")).toContainText("Fake runtime finding");
});

test("runs command output, saves settings, and searches workspace files", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByTestId("desktop-shell")).toBeVisible();
  await ensureWorkspace(page);
  await ensureThread(page);
  await expect(page.getByTestId("composer-fast-toggle")).toHaveAttribute("aria-pressed", "false");
  await page.getByTestId("composer-fast-toggle").click();
  await expect(page.getByTestId("composer-fast-toggle")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("composer-reasoning-select").click();
  await page.getByTestId("composer-reasoning-select-option-medium").click();
  await expect(page.getByTestId("composer-reasoning-select")).toHaveAttribute("data-value", "medium");

  await page.getByTestId("inspector-tab-command").click();
  await page.getByTestId("command-input").fill("printf 'hi from e2e\\n'");
  await page.getByTestId("command-run-button").click();
  await expect(page.getByTestId("command-output")).toContainText("hi from e2e");

  await page.getByTestId("settings-button").click();
  await expect(page.getByTestId("settings-panel")).toBeVisible();
  await expect(page.getByTestId("settings-model-input")).toHaveValue("gpt-5-codex-spark");
  await page.getByTestId("settings-model-input").fill("gpt-5-codex-smoke");
  await expect(page.getByTestId("settings-reasoning-effort")).toHaveValue("medium");
  await page.getByTestId("settings-reasoning-effort").selectOption("xhigh");
  await page.getByTestId("settings-approval-policy").selectOption("never");
  await page.getByTestId("settings-sandbox-mode").selectOption("read-only");
  await page.getByTestId("settings-save-button").click();

  await page.reload();
  await page.getByTestId("settings-button").click();
  await expect(page.getByTestId("settings-model-input")).toHaveValue("gpt-5-codex-smoke");
  await expect(page.getByTestId("settings-reasoning-effort")).toHaveValue("xhigh");
  await expect(page.getByTestId("settings-approval-policy")).toHaveValue("never");
  await expect(page.getByTestId("settings-sandbox-mode")).toHaveValue("read-only");
  await page.getByTestId("settings-panel").getByRole("button", { name: "关闭" }).click();

  await page.getByTestId("workspace-search-button").click();
  await page.getByTestId("workspace-search-input").fill("package");
  await expect(page.getByTestId("workspace-search-result").first()).toContainText("package.json");
});

test("renders markdown and media resources inside the timeline stream", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByTestId("desktop-shell")).toBeVisible();
  await ensureWorkspace(page);
  await ensureThread(page);

  const prompt = [
    "# Markdown Media",
    "",
    "- alpha",
    "- **beta**",
    "",
    "![](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2L1b8AAAAASUVORK5CYII=)",
    "",
    "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=",
  ].join("\n");

  await page.getByTestId("composer-input").fill(prompt);
  await page.getByTestId("send-button").click();

  const timeline = page.getByTestId("timeline-list");
  await expect(timeline.getByRole("heading", { name: "Markdown Media" })).toBeVisible();
  await expect(timeline.getByRole("listitem").filter({ hasText: "alpha" })).toBeVisible();
  await expect(timeline.locator("strong").filter({ hasText: "beta" }).first()).toBeVisible();
  await expect(timeline.locator("img").first()).toHaveAttribute("src", /data:image\/png/i);
  await expect(timeline.locator("audio").first()).toHaveAttribute("src", /data:audio\/wav/i);
  await timeline.locator("img").first().click();
  await expect(page.getByTestId("image-preview-modal")).toBeVisible();
  await expect(page.getByTestId("image-preview-full")).toHaveAttribute("src", /data:image\/png/i);
});

test("opens local code links in a syntax-highlighted preview modal", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByTestId("desktop-shell")).toBeVisible();
  await ensureWorkspace(page);
  await ensureThread(page);

  const filePath = `${process.cwd()}/apps/web/src/App.tsx`;
  const prompt = `[App.tsx](${filePath}#L1)`;

  await page.getByTestId("composer-input").fill(prompt);
  await page.getByTestId("send-button").click();

  const timeline = page.getByTestId("timeline-list");
  await timeline.getByRole("link", { name: "App.tsx" }).click();

  await expect(page.getByTestId("code-preview-modal")).toBeVisible();
  await expect(page.getByTestId("code-preview-title")).toContainText("App.tsx");
  await expect(page.getByTestId("code-preview-modal")).toContainText("第 1 行");
  await expect(page.getByTestId("code-preview-editor")).toBeVisible();
});

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

    await page.getByTestId("workspace-name-input").fill("webcli-e2e");
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
  await threadRows.nth(existingCount).click();
}
