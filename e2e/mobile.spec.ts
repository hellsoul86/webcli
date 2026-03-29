import { expect, test, type Page } from "@playwright/test";

// Mobile viewport: iPhone 14-ish
const MOBILE = { width: 375, height: 812 };

test.describe("Mobile layout", () => {
  test.describe.configure({ mode: "serial" });

  test.use({ viewport: MOBILE });

  test("hides sidebar and shows hamburger menu on mobile", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("desktop-shell")).toBeVisible();

    // Create workspace and thread so sidebar auto-hides
    await ensureWorkspace(page);
    await ensureThread(page);

    // After selecting a thread on mobile, sidebar should close (no --open class)
    await expect(page.locator(".sidebar-shell--open")).toHaveCount(0);

    // Hamburger menu button should be visible in the header
    await expect(page.getByRole("button", { name: "菜单" })).toBeVisible();

    // Composer area should be visible
    await expect(page.getByTestId("composer-input")).toBeVisible();
  });

  test("opens sidebar drawer on hamburger click", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("desktop-shell")).toBeVisible();
    await ensureWorkspace(page);
    await ensureThread(page);

    // Sidebar should be hidden
    await expect(page.locator(".sidebar-shell--open")).toHaveCount(0);

    // Click hamburger
    await page.getByRole("button", { name: "菜单" }).click();

    // Sidebar drawer opens
    await expect(page.locator(".sidebar-shell--open")).toBeVisible();

    // Overlay backdrop visible
    await expect(page.locator(".mobile-drawer-overlay--visible")).toBeVisible();
  });

  test("closes drawer on overlay click", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("desktop-shell")).toBeVisible();
    await ensureWorkspace(page);
    await ensureThread(page);

    // Open drawer
    await page.getByRole("button", { name: "菜单" }).click();
    await expect(page.locator(".sidebar-shell--open")).toBeVisible();

    // Click overlay
    await page.locator(".mobile-drawer-overlay--visible").click();

    // Drawer closes
    await expect(page.locator(".sidebar-shell--open")).toHaveCount(0);
  });

  test("closes drawer on thread select", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("desktop-shell")).toBeVisible();
    await ensureWorkspace(page);
    await ensureThread(page);

    // Open drawer
    await page.getByRole("button", { name: "菜单" }).click();
    await expect(page.locator(".sidebar-shell--open")).toBeVisible();

    // Click the thread row in the now-visible sidebar
    const threadRow = page.locator(".sidebar-shell--open").locator('[data-testid^="thread-row-"]').first();
    await threadRow.scrollIntoViewIfNeeded();
    await threadRow.click();

    // Drawer auto-closes
    await expect(page.locator(".sidebar-shell--open")).toHaveCount(0);
  });

  test("composer toolbar shows model selectors on mobile", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("desktop-shell")).toBeVisible();
    await ensureWorkspace(page);
    await ensureThread(page);

    // Composer input visible
    await expect(page.getByTestId("composer-input")).toBeVisible();

    // Model, reasoning, approval policy selectors should be visible
    await expect(page.getByTestId("composer-model-select")).toBeVisible();
    await expect(page.getByTestId("composer-reasoning-select")).toBeVisible();
    await expect(page.getByTestId("composer-approval-policy-select")).toBeVisible();
  });

  test("sends message and sees response on mobile", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("desktop-shell")).toBeVisible();
    await ensureWorkspace(page);
    await ensureThread(page);

    const prompt = `mobile-test-${Date.now()}`;
    await page.getByTestId("composer-input").fill(prompt);
    await page.getByTestId("send-button").click();

    const timeline = page.getByTestId("timeline-list");
    await expect(
      timeline.locator("article").filter({ hasText: prompt }).first(),
    ).toBeVisible();
    await expect(
      timeline.locator("article").filter({ hasText: "READY" }).first(),
    ).toBeVisible();
  });

  test("composer sticks to bottom when scrolling", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("desktop-shell")).toBeVisible();
    await ensureWorkspace(page);
    await ensureThread(page);

    const timeline = page.getByTestId("timeline-list");

    // Send a message to populate the timeline
    const prompt = `scroll-test-${Date.now()}`;
    await page.getByTestId("composer-input").fill(prompt);
    await page.getByTestId("send-button").click();

    // Wait for the full response
    await expect(
      timeline.locator("article").filter({ hasText: "READY" }).first(),
    ).toBeVisible();

    // Force scroll the timeline container to the top
    await timeline.evaluate((el) => el.scrollTo(0, 0));

    // Composer should remain visible (sticky at bottom of viewport)
    await expect(page.getByTestId("composer-input")).toBeVisible();
    await expect(page.getByTestId("composer-input")).toBeInViewport();
  });

  test("decision center works on mobile", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("desktop-shell")).toBeVisible();
    await ensureWorkspace(page);
    await ensureThread(page);

    // Trigger a decision request
    await page.getByTestId("composer-input").fill(`request-user-input:${Date.now()}`);
    await page.getByTestId("send-button").click();

    const decisionCard = page.locator('[data-testid^="decision-card-"]').first();
    await expect(decisionCard).toBeVisible();

    // Accept the decision
    await decisionCard.getByRole("combobox").selectOption("accept");
    await decisionCard.locator('[data-testid^="decision-submit-"]').click();
    await expect(page.locator('[data-testid^="decision-card-"]')).toHaveCount(0);
  });
});

test.describe("Desktop layout unaffected by mobile code", () => {
  test.describe.configure({ mode: "serial" });

  // Default viewport is desktop-sized (1280x720 from Playwright defaults)

  test("desktop shows persistent sidebar without hamburger", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("desktop-shell")).toBeVisible();
    await ensureWorkspace(page);
    await ensureThread(page);

    // Sidebar should always be visible (no hamburger button needed)
    await expect(page.getByRole("button", { name: "菜单" })).toHaveCount(0);

    // Sidebar and content should be side by side
    await expect(page.locator('[data-testid^="workspace-row-"]').first()).toBeVisible();
    await expect(page.getByTestId("composer-input")).toBeVisible();

    // Resizer handle should be present
    await expect(page.getByTestId("sidebar-resizer")).toBeVisible();
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

    await page.getByTestId("workspace-name-input").fill("webcli-mobile-e2e");
    await page.getByTestId("workspace-path-input").fill(workspaceDisplayPath);
    await page.getByTestId("workspace-save-button").click();
    await expect(workspaceRows.first()).toBeVisible();
  } else {
    await workspaceRows.first().click();
  }

  await expect(threadOpenButton).toBeEnabled();
}

async function ensureThread(page: Page): Promise<void> {
  // On mobile, clicking thread-open-button creates AND auto-selects the thread,
  // which also closes the sidebar. We just need to wait for the composer to appear.
  await page.getByTestId("thread-open-button").click();
  await expect(page.getByTestId("composer-input")).toBeVisible();
}
