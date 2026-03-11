import { afterEach, describe, expect, it } from "vitest";
import type { Thread } from "@webcli/codex-protocol";
import {
  resetWorkbenchPersistStorage,
  selectTimeline,
  useWorkbenchStore,
} from "./workbench-store";

function makeThread(): Thread {
  return {
    id: "thread-1",
    preview: "Test",
    ephemeral: false,
    modelProvider: "openai",
    createdAt: 1,
    updatedAt: 2,
    status: { type: "idle" },
    path: null,
    cwd: "/srv/project",
    cliVersion: "0.111.0",
    source: "appServer",
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: "Demo thread",
    turns: [
      {
        id: "turn-1",
        status: "completed",
        error: null,
        items: [
          {
            type: "agentMessage",
            id: "item-1",
            text: "Hello",
            phase: null,
          },
        ],
      },
    ],
  };
}

afterEach(() => {
  useWorkbenchStore.setState({
    connection: {
      connected: false,
      childPid: null,
      authenticated: false,
      requiresOpenaiAuth: true,
      restartCount: 0,
      lastError: null,
    },
    activeWorkspaceId: "all",
    activeThreadId: null,
    inspectorTab: "diff",
    threadLifecycle: {
      archivedMode: "active",
    },
    threads: {},
    pendingApprovals: [],
    commandSessions: {},
    commandOrder: [],
    integrations: {
      settingsOpen: false,
      settingsTab: "general",
      authStatus: null,
      config: null,
      mcpServers: [],
      skills: [],
      apps: [],
      plugins: [],
      fuzzySearch: {
        sessionId: null,
        query: "",
        status: "idle",
        results: [],
      },
    },
  });
  resetWorkbenchPersistStorage();
});

describe("workbench store", () => {
  it("hydrates a thread and flattens timeline entries", () => {
    const store = useWorkbenchStore.getState();
    store.hydrateThread(makeThread());

    const timeline = selectTimeline(useWorkbenchStore.getState().threads["thread-1"]);
    expect(timeline).toHaveLength(1);
    expect(timeline[0].body).toBe("Hello");
  });

  it("appends streaming deltas onto placeholder items", () => {
    const store = useWorkbenchStore.getState();
    store.hydrateThread({
      ...makeThread(),
      turns: [],
    });
    store.appendDelta("thread-1", "turn-1", "item-2", "agentMessage", "Part A");
    store.appendDelta("thread-1", "turn-1", "item-2", "agentMessage", " + Part B");

    const timeline = selectTimeline(useWorkbenchStore.getState().threads["thread-1"]);
    expect(timeline).toHaveLength(1);
    expect(timeline[0].body).toContain("Part A + Part B");
  });

  it("tracks archived thread lifecycle state", () => {
    const store = useWorkbenchStore.getState();
    store.hydrateThread(makeThread());
    store.markThreadArchived("thread-1", true);

    expect(useWorkbenchStore.getState().threads["thread-1"].archived).toBe(true);

    store.renameThread("thread-1", "Renamed");
    expect(useWorkbenchStore.getState().threads["thread-1"].thread.name).toBe("Renamed");
  });

  it("stores command session output and completion", () => {
    const store = useWorkbenchStore.getState();
    store.startCommandSession({
      processId: "proc-1",
      command: "git status",
      cwd: "/srv/project",
      tty: true,
      allowStdin: true,
    });
    store.appendCommandOutput("proc-1", "stdout", "hello");
    store.appendCommandOutput("proc-1", "stderr", "warn");
    store.completeCommandSession("proc-1", {
      exitCode: 0,
      stdout: "",
      stderr: "",
    });

    const session = useWorkbenchStore.getState().commandSessions["proc-1"];
    expect(session.stdout).toBe("hello");
    expect(session.stderr).toBe("warn");
    expect(session.status).toBe("completed");
  });
});
