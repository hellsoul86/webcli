import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });

test("creates a workspace, opens a thread, and replays approvals after reload", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.getByTestId("desktop-shell")).toBeVisible();
  await expect(page.getByTestId("settings-button")).toBeVisible();

  await ensureWorkspace(page);
  await ensureThread(page);
  await expect(page.getByTestId("thread-summary-display")).toBeVisible();

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

  await page.getByTestId("git-workbench-open-button").click();
  await expect(page.getByTestId("git-workbench")).toBeVisible();
  await expect(page.getByTestId("git-review-group-conflicted")).toBeVisible();
  await expect(page.getByTestId("git-review-group-staged-unstaged")).toBeVisible();
  const conflictedGroup = page.getByTestId("git-review-group-conflicted");
  await conflictedGroup.getByRole("button", { name: /docs/i }).click({ force: true });
  await expect(page.getByTestId("git-review-path")).toContainText("docs/review/notes.md");
  await expect(page.getByText("Merge conflicts are shown as raw patch output.")).toBeVisible();
  const unstagedGroup = page.getByTestId("git-review-group-unstaged");
  await unstagedGroup
    .getByRole("button", { name: /README.md/i })
    .evaluate((node) => (node as HTMLButtonElement).click());
  await expect(page.getByTestId("git-review-path")).toContainText("README.md");
  await expect(page.getByText("Old heading").first()).toBeVisible();
  await expect(page.getByText("# WebCLI").first()).toBeVisible();
  await page.getByTestId("git-remote-diff-button").click();
  await expect(page.getByTestId("git-review-path")).toContainText("远端与工作树差异");
  await expect(page.getByTestId("git-remote-diff-view")).toContainText("Remote diff coverage");
  await page.getByRole("button", { name: "返回会话" }).click();

  const decisionCard = page.locator('[data-testid^="decision-card-"]').first();
  await expect(decisionCard).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("desktop-shell")).toBeVisible();
  await expect(page.locator('[data-testid^="decision-card-"]').first()).toBeVisible();
  await page.locator('[data-testid^="decision-accept-"]').first().click();
  await expect(page.locator('[data-testid^="decision-card-"]')).toHaveCount(0);
});

test("updates defaults and searches workspace files from the command palette", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByTestId("desktop-shell")).toBeVisible();
  await ensureWorkspace(page);
  await ensureThread(page);
  await expect(page.getByTestId("composer-speed-switch")).toHaveAttribute("aria-checked", "false");
  await page.getByTestId("composer-speed-switch").click();
  await expect(page.getByTestId("composer-speed-switch")).toHaveAttribute("aria-checked", "true");
  await page.getByTestId("composer-reasoning-select").click();
  await page.getByTestId("composer-reasoning-select-option-medium").click();
  await expect(page.getByTestId("composer-reasoning-select")).toHaveAttribute("data-value", "medium");

  await page.getByTestId("settings-button").click();
  await expect(page.getByTestId("settings-panel")).toBeVisible();
  await page.getByRole("button", { name: "默认代理" }).click();
  await expect(page.getByTestId("settings-model-input")).toHaveValue("gpt-5-codex");
  await page.getByTestId("settings-model-input").fill("gpt-5-codex-spark");
  await page.getByTestId("settings-reasoning-effort").selectOption("xhigh");
  await page.getByTestId("settings-approval-policy").selectOption("never");
  await page.getByTestId("settings-sandbox-mode").selectOption("read-only");
  await page.getByTestId("settings-save-button").click();

  await page.reload();
  await page.getByTestId("settings-button").click();
  await page.getByRole("button", { name: "默认代理" }).click();
  await expect(page.getByTestId("settings-model-input")).toHaveValue("gpt-5-codex-spark");
  await expect(page.getByTestId("settings-reasoning-effort")).toHaveValue("xhigh");
  await expect(page.getByTestId("settings-approval-policy")).toHaveValue("never");
  await expect(page.getByTestId("settings-sandbox-mode")).toHaveValue("read-only");
  await page.getByTestId("settings-panel").getByRole("button", { name: "关闭" }).click();

  await openCommandPalette(page);
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
  await timeline
    .locator("img")
    .first()
    .evaluate((node) => (node as HTMLImageElement).click());
  await expect(page.getByTestId("image-preview-modal")).toBeVisible();
  await expect(page.getByTestId("image-preview-full")).toHaveAttribute("src", /data:image\/png/i);
});

test("streams assistant replies incrementally without replacing the item", async ({ page }) => {
  const consoleErrors: Array<string> = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  await page.goto("/");

  await expect(page.getByTestId("desktop-shell")).toBeVisible();
  await ensureWorkspace(page);
  await ensureThread(page);

  const prompt = `stream-${Date.now()}`;
  const expectedReply = `READY ${prompt}`;
  await page.getByTestId("composer-input").fill(prompt);
  await page.getByTestId("send-button").click();

  const timeline = page.getByTestId("timeline-list");
  await expect.poll(async () => {
    const texts = await timeline.locator("article").allTextContents();
    return texts.some((text) => text.trim() === "RE");
  }).toBe(true);

  await expect.poll(async () => {
    const texts = await timeline.locator("article").allTextContents();
    return texts.some((text) => text.includes(expectedReply));
  }).toBe(true);

  expect(consoleErrors).toEqual([]);
});

test("renders raw response items and terminal interactions as first-class timeline entries", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.getByTestId("desktop-shell")).toBeVisible();
  await ensureWorkspace(page);
  await ensureThread(page);

  const prompt = `timeline-parity:${Date.now()}`;
  await page.getByTestId("composer-input").fill(prompt);
  await page.getByTestId("send-button").click();

  const timeline = page.getByTestId("timeline-list");
  const rawResponseToggle = timeline.getByRole("button", { name: /原始响应消息/ }).first();
  await expect(rawResponseToggle).toBeVisible();
  await rawResponseToggle.click();
  await expect(timeline.getByText("角色：")).toBeVisible();
  await expect(timeline.getByText("Raw response hello")).toBeVisible();

  const terminalInteraction = timeline
    .locator("article")
    .filter({ hasText: "终端输入" })
    .filter({ hasText: "fake-process-1" })
    .first();
  await expect(terminalInteraction).toBeVisible();
  await expect(terminalInteraction).toContainText("终端输入");
  await expect(terminalInteraction).toContainText("y");
  await expect(terminalInteraction).toContainText("进程：");
  await expect(terminalInteraction).toContainText("fake-process-1");
  const commandToggle = timeline.getByRole("button", { name: /已执行/ }).first();
  await expect(commandToggle).toBeVisible();
  await commandToggle.click();
  await expect(timeline.getByText("1 passed")).toBeVisible();
});

test("submits typed request-user-input decisions from the decision center", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByTestId("desktop-shell")).toBeVisible();
  await ensureWorkspace(page);
  await ensureThread(page);

  await page
    .getByTestId("composer-input")
    .fill(`request-user-input:${Date.now()}`);
  await page.getByTestId("send-button").click();

  const decisionCard = page.locator('[data-testid^="decision-card-"]').first();
  await expect(decisionCard).toBeVisible();
  await decisionCard.getByRole("combobox").selectOption("decline");
  await decisionCard.locator('[data-testid^="decision-submit-"]').click();
  await expect(page.locator('[data-testid^="decision-card-"]')).toHaveCount(0);
});

test("renders realtime transcript and audio sessions as a first-class panel", async ({ page }) => {
  const consoleErrors: Array<string> = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  await page.goto("/");

  await expect(page.getByTestId("desktop-shell")).toBeVisible();
  await ensureWorkspace(page);
  await ensureThread(page);

  await page
    .getByTestId("composer-input")
    .fill(`realtime-smoke:${Date.now()}`);
  await page.getByTestId("send-button").click();

  const panel = page.getByTestId("realtime-session-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("realtime-transcript")).toContainText("Realtime hello");
  await expect(panel.getByTestId("realtime-transcript")).toContainText("Second realtime line");
  await expect(panel.getByTestId("realtime-audio-player")).toBeVisible();
  await expect(panel.getByTestId("realtime-session-status")).toContainText(
    /Closed|已关闭|已结束/i,
  );

  expect(consoleErrors).toEqual([]);
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
  await timeline
    .getByRole("link", { name: "App.tsx" })
    .evaluate((node) => (node as HTMLAnchorElement).click());

  await expect(page.getByTestId("code-preview-modal")).toBeVisible();
  await expect(page.getByTestId("code-preview-title")).toContainText("App.tsx");
  await expect(page.getByTestId("code-preview-modal")).toContainText("第 1 行");
  await expect(page.getByTestId("code-preview-editor")).toBeVisible();
});

test("opens /srv absolute code links in the preview modal", async ({ page }) => {
  const filePath = "/srv/webcli-staging/repo/apps/web/src/App.tsx";
  await page.route("**/api/resource?*", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/resource" && url.searchParams.get("path") === filePath) {
      await route.fulfill({
        status: 200,
        contentType: "text/plain; charset=utf-8",
        body: "export const App = () => <main>srv preview</main>;\n",
      });
      return;
    }

    await route.fallback();
  });

  await page.goto("/");

  await expect(page.getByTestId("desktop-shell")).toBeVisible();
  await ensureWorkspace(page);
  await ensureThread(page);

  await page.getByTestId("composer-input").fill(`[App.tsx](${filePath}#L1)`);
  await page.getByTestId("send-button").click();

  const timeline = page.getByTestId("timeline-list");
  await timeline
    .getByRole("link", { name: "App.tsx" })
    .evaluate((node) => (node as HTMLAnchorElement).click());

  await expect(page.getByTestId("code-preview-modal")).toBeVisible();
  await expect(page.getByTestId("code-preview-title")).toContainText("App.tsx");
  await expect(page.getByTestId("code-preview-editor")).toBeVisible();
  await expect(page.getByTestId("code-preview-modal")).toContainText("第 1 行");
});

test("does not log monaco dispose errors when closing review and code preview", async ({
  page,
}) => {
  const consoleErrors: Array<string> = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  await page.goto("/");

  await expect(page.getByTestId("desktop-shell")).toBeVisible();
  await ensureWorkspace(page);
  await ensureThread(page);

  await page.getByTestId("git-workbench-open-button").click();
  await expect(page.getByTestId("git-workbench")).toBeVisible();
  const unstagedGroup = page.getByTestId("git-review-group-unstaged");
  await unstagedGroup
    .getByRole("button", { name: /README.md/i })
    .evaluate((node) => (node as HTMLButtonElement).click());
  await expect(page.getByText("Old heading").first()).toBeVisible();
  await page.getByRole("button", { name: "返回会话" }).click();
  await page.waitForTimeout(300);

  const filePath = `${process.cwd()}/apps/web/src/App.tsx`;
  await page.getByTestId("composer-input").fill(`[App.tsx](${filePath}#L1)`);
  await page.getByTestId("send-button").click();

  const timeline = page.getByTestId("timeline-list");
  await timeline
    .getByRole("link", { name: "App.tsx" })
    .evaluate((node) => (node as HTMLAnchorElement).click());
  await expect(page.getByTestId("code-preview-modal")).toBeVisible();
  await page.getByRole("button", { name: "关闭" }).last().click();
  await page.waitForTimeout(300);

  const monacoDisposeErrors = consoleErrors.filter((entry) =>
    /TextModel got disposed before Diff|TextModel.*disposed|Diff.*disposed/i.test(entry),
  );
  expect(monacoDisposeErrors).toEqual([]);
});

test("groups outside-home threads under a derived workspace and can dismiss it", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.getByTestId("desktop-shell")).toBeVisible();
  const externalWorkspaceRow = page
    .locator('[data-testid^="workspace-row-"]')
    .filter({ hasText: "repo" })
    .first();
  await expect(externalWorkspaceRow).toBeVisible();

  const externalThreadRow = page
    .locator('[data-testid^="thread-row-"]')
    .filter({ hasText: "Staging repo" })
    .first();
  await expect(externalThreadRow).toBeVisible();
  await externalThreadRow.click();

  await page.getByTestId("git-workbench-open-button").click();
  await expect(page.getByTestId("git-workbench")).toBeVisible();
  await expect(page.getByTestId("git-review-group-conflicted")).toBeVisible();
  await expect(page.getByTestId("git-review-path")).toContainText("docs/review/notes.md");
  await page.getByRole("button", { name: "返回会话" }).click();

  const externalWorkspaceCard = externalWorkspaceRow.locator(
    "xpath=ancestor::div[contains(@class,'workspace-row')]",
  );
  await externalWorkspaceCard.getByRole("button", { name: "维护项目" }).click();
  await expect(page.getByText("接管项目")).toBeVisible();
  await page.getByRole("button", { name: "移除" }).click();

  await expect(
    page.locator('[data-testid^="workspace-row-"]').filter({ hasText: "repo" }),
  ).toHaveCount(0);

  await page.reload();
  await expect(page.getByTestId("desktop-shell")).toBeVisible();
  await expect(
    page.locator('[data-testid^="workspace-row-"]').filter({ hasText: "repo" }),
  ).toHaveCount(0);
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
  await threadRows.first().click();
}

async function openCommandPalette(page: Page): Promise<void> {
  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
  await expect(page.getByTestId("workspace-search-input")).toBeVisible();
}
