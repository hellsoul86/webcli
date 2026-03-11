import { expect, test } from "@playwright/test";

test("renders the desktop shell, runs a command session, opens settings, and archives a thread", async ({
  page,
}) => {
  const workspacePath = process.cwd();
  const homePath = process.env.HOME ?? "";
  const workspaceDisplayPath = workspacePath.startsWith(homePath)
    ? `~${workspacePath.slice(homePath.length)}`
    : workspacePath;
  const prompt = `Reply with exactly READY. ${Date.now()}`;

  await page.goto("/");

  await expect(page.locator(".desktop-shell")).toBeVisible();
  await expect(page.getByTestId("composer-input")).toBeVisible();
  await expect(page.getByTestId("settings-button")).toBeVisible();

  const workspaceRows = page.locator(".workspace-row__main");
  if ((await workspaceRows.count()) === 0) {
    await page.getByTestId("workspace-create-button").click();
    await page.getByTestId("workspace-name-input").fill("webcli");
    await page.getByTestId("workspace-path-input").fill("/tmp");
    await expect(page.getByTestId("workspace-save-button")).toBeDisabled();
    await page.getByTestId("workspace-path-input").fill(workspaceDisplayPath);
    await page.getByTestId("workspace-save-button").click();
  }

  await expect(page.locator(".workspace-row__main").first()).toBeVisible();
  await page.locator(".workspace-row__main").first().click();
  await expect(page.locator(".thread-list")).toBeVisible();
  await expect(page.getByRole("button", { name: "新项目" })).toBeVisible();

  await page.getByRole("button", { name: "Command" }).click();
  await page.getByTestId("command-input").fill("printf 'hi from e2e\\n'");
  await page.getByTestId("command-run-button").click();
  await expect(page.locator(".terminal-output")).toContainText("hi from e2e");

  await page.getByTestId("settings-button").click();
  await expect(page.locator(".settings-panel")).toBeVisible();
  await expect(page.getByText("桌面工作台配置")).toBeVisible();
  await page.getByRole("button", { name: "关闭" }).first().click();

  await page.getByTestId("composer-input").fill(prompt);
  await page.getByTestId("send-button").click();

  await expect(page.locator(".thread-row").first()).toBeVisible();
  await expect(page.locator(".thread-row").first().locator("p")).toHaveCount(0);

  const threadRows = page.locator(".thread-row");
  if ((await threadRows.count()) > 1) {
    const targetTitle = await threadRows.nth(1).locator("strong").innerText();
    await threadRows.nth(1).locator(".thread-row__main").click();
    await expect(page.locator(".conversation-header h1")).toContainText(targetTitle);
    await expect(threadRows.nth(1)).toHaveClass(/thread-row--active/);
  }

  await page.getByTestId(/thread-menu-/).first().click();
  await page.getByRole("button", { name: "归档切换" }).click();

  await page.getByTestId("threads-archived-toggle").click();
  await expect(page.locator(".thread-row").first()).toBeVisible();
});
