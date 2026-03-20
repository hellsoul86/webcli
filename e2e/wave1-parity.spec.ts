import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });

test("covers wave1 thread and decision flows", async ({ page }) => {
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
  await expect(page.locator('[data-testid^="thread-row-"]').first()).toBeVisible();
  await expect(page.getByTestId("thread-summary-display")).toBeVisible();
  await page.getByTestId("settings-button").click();
  const settingsPanel = page.getByTestId("settings-panel");
  await expect(settingsPanel).toBeVisible();
  await settingsPanel.getByRole("button", { name: "历史" }).click();
  await expect(settingsPanel).toContainText("归档线程");
  await settingsPanel.getByRole("button", { name: "关闭" }).click();
  await expect(settingsPanel).toHaveCount(0);

  await page.getByTestId("composer-input").fill(`request-user-input:${Date.now()}`);
  await page.getByTestId("send-button").click();
  const decisionCard = page.locator('[data-testid^="decision-card-"]').first();
  await expect(decisionCard).toBeVisible();
  await decisionCard.getByRole("combobox").selectOption("accept");
  await decisionCard.locator('[data-testid^="decision-submit-"]').click();
  await expect(page.locator('[data-testid^="decision-card-"]')).toHaveCount(0);

  expect(consoleErrors).toEqual([]);
});

test("covers wave1 file preview flows", async ({ page }) => {
  const consoleErrors: Array<string> = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  const srvPath = "/srv/webcli-staging/repo/apps/web/src/App.tsx";
  await page.route("**/api/resource?*", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/resource" && url.searchParams.get("path") === srvPath) {
      await route.fulfill({
        status: 200,
        contentType: "text/plain; charset=utf-8",
        body: "export const App = () => <main>wave1 parity preview</main>;\n",
      });
      return;
    }

    await route.fallback();
  });

  await page.goto("/");

  await expect(page.getByTestId("desktop-shell")).toBeVisible();
  await ensureWorkspace(page);
  await ensureThread(page);

  await page.getByTestId("composer-input").fill(`[srv-preview](${srvPath}#L1)`);
  await page.getByTestId("send-button").click();
  await page
    .getByTestId("timeline-list")
    .getByRole("link", { name: "srv-preview" })
    .evaluate((node) => (node as HTMLAnchorElement).click());
  const codePreviewModal = page.getByTestId("code-preview-modal");
  await expect(codePreviewModal).toBeVisible();
  await expect(page.getByTestId("code-preview-title")).toContainText("srv-preview");
  await codePreviewModal.getByRole("button", { name: "关闭" }).click();
  await expect(codePreviewModal).toHaveCount(0);

  expect(consoleErrors).toEqual([]);
});

test("covers wave1 review and remote diff flows", async ({ page }) => {
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
  await expect(page.getByTestId("git-review-path")).toContainText("README.md");
  await page.getByTestId("git-remote-diff-button").click();
  await expect(page.getByTestId("git-remote-diff-view")).toContainText("Remote diff coverage");
  await page.getByRole("button", { name: "返回会话" }).click();

  expect(consoleErrors).toEqual([]);
});

test("covers wave1 settings and integration capability surfaces", async ({ page }) => {
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

  await page.getByTestId("settings-button").click();
  const settingsPanel = page.getByTestId("settings-panel");
  await expect(settingsPanel).toBeVisible();

  await settingsPanel.getByRole("button", { name: "集成" }).click();
  await expect(settingsPanel).toContainText("MCP Servers");

  await settingsPanel.getByRole("button", { name: "扩展" }).click();
  await expect(settingsPanel).toContainText("技能");
  await expect(settingsPanel).toContainText("远程技能");
  await expect(settingsPanel).toContainText("应用");
  await expect(settingsPanel).toContainText("插件");

  await settingsPanel.getByRole("button", { name: "账号" }).click();
  await expect(settingsPanel).toContainText("详细速率限制");
  await expect(settingsPanel).toContainText("外部代理配置导入");
  await expect(settingsPanel).toContainText("告警与模型改路由");

  await settingsPanel.getByRole("button", { name: "默认代理" }).click();
  await expect(settingsPanel).toContainText("配置要求");
  await expect(page.getByTestId("settings-model-input")).toBeVisible();

  await settingsPanel.getByRole("button", { name: "历史" }).click();
  await expect(settingsPanel).toContainText("归档线程");
  await settingsPanel.getByRole("button", { name: "关闭" }).click();
  await expect(settingsPanel).toHaveCount(0);

  expect(consoleErrors).toEqual([]);
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

    await page.getByTestId("workspace-name-input").fill("webcli-wave1");
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
