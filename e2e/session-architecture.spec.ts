import { expect, test } from "@playwright/test";
import { request as apiRequest } from "@playwright/test";
import { ensureWorkspace, ensureThread } from "./fixtures";

test.describe("Session architecture", () => {
  test.describe.configure({ mode: "serial" });

  const apiBase = "http://127.0.0.1:45100";

  test("session lifecycle via REST API", async () => {
    const api = await apiRequest.newContext({ baseURL: apiBase });

    // POST /api/sessions → creates session
    const createRes = await api.post("/api/sessions", {
      data: { cwd: "/tmp" },
    });
    expect(createRes.status()).toBe(201);
    const created = await createRes.json();
    expect(created.sessionId).toBeTruthy();
    expect(created.status.state).toBe("idle");

    const sessionId = created.sessionId as string;

    // GET /api/sessions → lists sessions including the new one
    const listRes = await api.get("/api/sessions");
    expect(listRes.ok()).toBe(true);
    const list = await listRes.json();
    expect(list.items.length).toBeGreaterThanOrEqual(1);
    expect(list.items.some((s: { id: string }) => s.id === sessionId)).toBe(
      true,
    );

    // GET /api/sessions/:id → returns session details
    const getRes = await api.get(`/api/sessions/${sessionId}`);
    expect(getRes.ok()).toBe(true);
    const detail = await getRes.json();
    expect(detail.sessionId).toBe(sessionId);
    expect(detail.status.state).toBe("idle");

    // DELETE /api/sessions/:id → removes session
    const deleteRes = await api.delete(`/api/sessions/${sessionId}`);
    expect(deleteRes.status()).toBe(204);

    // GET after delete → 404
    const getAfterDelete = await api.get(`/api/sessions/${sessionId}`);
    expect(getAfterDelete.status()).toBe(404);

    await api.dispose();
  });

  test("DELETE nonexistent session returns 404", async () => {
    const api = await apiRequest.newContext({ baseURL: apiBase });
    const res = await api.delete("/api/sessions/nonexistent-id");
    expect(res.status()).toBe(404);
    await api.dispose();
  });

  test("per-session WebSocket connects and receives events", async ({
    page,
  }) => {
    const api = await apiRequest.newContext({ baseURL: apiBase });

    // Create session via REST
    const createRes = await api.post("/api/sessions");
    expect(createRes.status()).toBe(201);
    const { sessionId } = await createRes.json();

    // Connect WebSocket and exchange messages via page context
    const wsResult = await page.evaluate(async (sid: string) => {
      const wsUrl = `ws://127.0.0.1:45100/ws/sessions/${sid}`;
      const messages: Array<Record<string, unknown>> = [];

      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        const timeout = setTimeout(() => {
          ws.close();
          reject(new Error("WebSocket timeout"));
        }, 8000);

        ws.addEventListener("message", (event) => {
          const data = JSON.parse(event.data as string) as Record<
            string,
            unknown
          >;
          messages.push(data);
        });

        ws.addEventListener("open", () => {
          // Wait briefly for initial runtime.statusChanged notification
          setTimeout(() => {
            // Send thread.list RPC
            ws.send(
              JSON.stringify({
                type: "client.call",
                id: "test-thread-list",
                method: "thread.list",
                params: { archived: false },
              }),
            );
          }, 200);
        });

        ws.addEventListener("error", () => {
          clearTimeout(timeout);
          reject(new Error("WebSocket error"));
        });

        // Wait for the RPC response
        const checkInterval = setInterval(() => {
          const hasResponse = messages.some(
            (m) =>
              m.type === "server.response" && m.id === "test-thread-list",
          );
          if (hasResponse) {
            clearInterval(checkInterval);
            clearTimeout(timeout);
            ws.close();
            resolve();
          }
        }, 100);
      });

      return messages;
    }, sessionId);

    // Should have received runtime.statusChanged notification
    const statusMsg = wsResult.find(
      (m: Record<string, unknown>) =>
        m.type === "server.notification" &&
        m.method === "runtime.statusChanged",
    );
    expect(statusMsg).toBeTruthy();

    // Should have received thread.list response
    const threadListResponse = wsResult.find(
      (m: Record<string, unknown>) =>
        m.type === "server.response" && m.id === "test-thread-list",
    );
    expect(threadListResponse).toBeTruthy();
    expect(threadListResponse.result).toBeTruthy();

    // Cleanup
    await api.delete(`/api/sessions/${sessionId}`);
    await api.dispose();
  });

  test("WebSocket to nonexistent session closes with 4004", async ({
    page,
  }) => {
    const closeCode = await page.evaluate(async () => {
      const wsUrl = "ws://127.0.0.1:45100/ws/sessions/nonexistent-session";
      return new Promise<number>((resolve) => {
        const ws = new WebSocket(wsUrl);
        const timeout = setTimeout(() => {
          ws.close();
          resolve(-1);
        }, 5000);

        ws.addEventListener("close", (event) => {
          clearTimeout(timeout);
          resolve(event.code);
        });

        ws.addEventListener("error", () => {
          // error fires before close; just wait for close
        });
      });
    });

    expect(closeCode).toBe(4004);
  });

  test("session persists across page reload", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("desktop-shell")).toBeVisible();
    await ensureWorkspace(page, "webcli-session-e2e");
    await ensureThread(page);

    // Capture session count from API before reload
    const api = await apiRequest.newContext({ baseURL: apiBase });
    const beforeRes = await api.get("/api/sessions");
    const beforeList = await beforeRes.json();
    const sessionCountBefore = beforeList.items.length;
    expect(sessionCountBefore).toBeGreaterThanOrEqual(1);

    // Reload the page
    await page.reload();
    await expect(page.getByTestId("desktop-shell")).toBeVisible();

    // Wait for the app to stabilize after reload
    await page.waitForTimeout(500);

    // Composer should still be visible (session resumed, not a blank state)
    await expect(page.getByTestId("composer-input")).toBeVisible();

    await api.dispose();
  });

  test("multiple sessions can coexist", async () => {
    const api = await apiRequest.newContext({ baseURL: apiBase });

    // Create two sessions
    const res1 = await api.post("/api/sessions", {
      data: { cwd: "/tmp/a" },
    });
    const res2 = await api.post("/api/sessions", {
      data: { cwd: "/tmp/b" },
    });
    expect(res1.status()).toBe(201);
    expect(res2.status()).toBe(201);

    const s1 = await res1.json();
    const s2 = await res2.json();
    expect(s1.sessionId).not.toBe(s2.sessionId);

    // Both should appear in the list
    const listRes = await api.get("/api/sessions");
    const list = await listRes.json();
    const ids = list.items.map((s: { id: string }) => s.id);
    expect(ids).toContain(s1.sessionId);
    expect(ids).toContain(s2.sessionId);

    // Cleanup
    await api.delete(`/api/sessions/${s1.sessionId}`);
    await api.delete(`/api/sessions/${s2.sessionId}`);
    await api.dispose();
  });
});
