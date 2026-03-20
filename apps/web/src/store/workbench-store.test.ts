import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitWorkingTreeSnapshot, WorkbenchThread } from "@webcli/contracts";
import {
  countTimelineEntries,
  resetWorkbenchPersistStorage,
  selectTimeline,
  selectTimelineWindow,
  useWorkbenchStore,
} from "./workbench-store";

function makeThread(): WorkbenchThread {
  return {
    thread: {
      id: "thread-1",
      name: "Demo thread",
      preview: "Test",
      archived: false,
      cwd: "/srv/project",
      createdAt: 1,
      updatedAt: 2,
      status: { type: "idle" },
      modelProvider: "openai",
      source: "appServer",
      agentNickname: null,
      agentRole: null,
      gitInfo: null,
      path: null,
      ephemeral: false,
      workspaceId: "workspace-1",
      workspaceName: "Workspace",
    },
    archived: false,
    turnOrder: ["turn-1"],
    turns: {
      "turn-1": {
        turn: {
          id: "turn-1",
          status: "completed",
          errorMessage: null,
        },
        itemOrder: ["item-1"],
        items: {
          "item-1": {
            id: "item-1",
            turnId: "turn-1",
            kind: "agentMessage",
            title: "Codex",
            body: "Hello",
            raw: { id: "item-1", type: "agentMessage" },
          },
        },
      },
    },
    latestDiff: "",
    latestPlan: null,
    review: null,
  };
}

function makeGitSnapshot(
  overrides: Partial<GitWorkingTreeSnapshot> = {},
): GitWorkingTreeSnapshot {
  return {
    workspaceId: "workspace-1",
    workspaceName: "Workspace",
    repoRoot: "/srv/project",
    branch: "main",
    isGitRepository: true,
    clean: false,
    stagedCount: 1,
    unstagedCount: 1,
    untrackedCount: 0,
    generatedAt: Date.now(),
    files: [
      {
        path: "src/app.ts",
        status: "modified",
        staged: true,
        unstaged: true,
        additions: 3,
        deletions: 1,
        patch: "diff --git a/src/app.ts b/src/app.ts\n+changed",
        oldPath: null,
      },
      {
        path: "README.md",
        status: "modified",
        staged: false,
        unstaged: true,
        additions: 1,
        deletions: 0,
        patch: "diff --git a/README.md b/README.md\n+readme",
        oldPath: null,
      },
    ],
    ...overrides,
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
    threadSummaries: {},
    hydratedThreads: {},
    hydratedOrder: [],
    gitSnapshotsByWorkspaceId: {},
    selectedGitFileByWorkspaceId: {},
    pendingApprovals: [],
    realtimeSessionsByThreadId: {},
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
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers();
});

describe("workbench store", () => {
  it("hydrates a thread and flattens timeline entries", () => {
    const store = useWorkbenchStore.getState();
    store.hydrateThread(makeThread());

    const timeline = selectTimeline(useWorkbenchStore.getState().hydratedThreads["thread-1"]);
    expect(timeline).toHaveLength(1);
    expect(timeline[0].body).toBe("Hello");
  });

  it("appends streaming deltas onto placeholder items", () => {
    const store = useWorkbenchStore.getState();
    store.hydrateThread({
      ...makeThread(),
      turnOrder: [],
      turns: {},
    });
    store.appendDelta("thread-1", "turn-1", "item-2", "agentMessage", "Part A");
    store.appendDelta("thread-1", "turn-1", "item-2", "agentMessage", " + Part B");

    const timeline = selectTimeline(useWorkbenchStore.getState().hydratedThreads["thread-1"]);
    expect(timeline).toHaveLength(1);
    expect(timeline[0].body).toContain("Part A + Part B");
  });

  it("applies batched streaming deltas in a single update", () => {
    const store = useWorkbenchStore.getState();
    store.hydrateThread({
      ...makeThread(),
      turnOrder: [],
      turns: {},
    });

    store.appendDeltaBatch([
      {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "item-2",
        kind: "agentMessage",
        delta: "Part A",
      },
      {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "item-2",
        kind: "agentMessage",
        delta: " + Part B",
      },
    ]);

    const timeline = selectTimeline(useWorkbenchStore.getState().hydratedThreads["thread-1"]);
    expect(timeline).toHaveLength(1);
    expect(timeline[0].body).toBe("Part A + Part B");
  });

  it("merges turn snapshots without discarding streamed items", () => {
    const store = useWorkbenchStore.getState();
    store.hydrateThread({
      ...makeThread(),
      turnOrder: [],
      turns: {},
    });

    store.appendDelta("thread-1", "turn-1", "item-2", "agentMessage", "Streaming reply");
    store.applyTurn("thread-1", {
      turn: {
        id: "turn-1",
        status: "completed",
        errorMessage: null,
      },
      itemOrder: ["item-1"],
      items: {
        "item-1": {
          id: "item-1",
          turnId: "turn-1",
          kind: "userMessage",
          title: "You",
          body: "Prompt",
          raw: { id: "item-1", type: "userMessage" },
        },
      },
    });

    const timeline = selectTimeline(useWorkbenchStore.getState().hydratedThreads["thread-1"]);
    expect(timeline.map((entry) => entry.id)).toEqual(["item-1", "item-2"]);
    expect(timeline.find((entry) => entry.id === "item-2")?.body).toBe("Streaming reply");
  });

  it("tracks archived thread lifecycle state", () => {
    const store = useWorkbenchStore.getState();
    store.hydrateThread(makeThread());
    store.markThreadArchived("thread-1", true);

    expect(useWorkbenchStore.getState().hydratedThreads["thread-1"].archived).toBe(true);

    store.renameThread("thread-1", "Renamed");
    expect(useWorkbenchStore.getState().hydratedThreads["thread-1"].thread.name).toBe("Renamed");
  });

  it("keeps only the active and most recent hydrated threads", () => {
    const store = useWorkbenchStore.getState();
    const threadA = makeThread();
    const threadB = {
      ...makeThread(),
      thread: {
        ...makeThread().thread,
        id: "thread-2",
        name: "Second thread",
      },
    };
    const threadC = {
      ...makeThread(),
      thread: {
        ...makeThread().thread,
        id: "thread-3",
        name: "Third thread",
      },
    };

    store.hydrateThread(threadA);
    store.hydrateThread(threadB);
    store.hydrateThread(threadC);
    store.touchHydratedThread("thread-3");
    store.sweepHydratedThreads("thread-1");

    expect(Object.keys(useWorkbenchStore.getState().hydratedThreads).sort()).toEqual([
      "thread-1",
      "thread-3",
    ]);
  });

  it("selects only the latest timeline window", () => {
    const thread = makeThread();
    thread.turns["turn-1"].itemOrder = ["item-1", "item-2", "item-3"];
    thread.turns["turn-1"].items["item-2"] = {
      id: "item-2",
      turnId: "turn-1",
      kind: "agentMessage",
      title: "Codex",
      body: "Two",
      raw: { id: "item-2", type: "agentMessage" },
    };
    thread.turns["turn-1"].items["item-3"] = {
      id: "item-3",
      turnId: "turn-1",
      kind: "agentMessage",
      title: "Codex",
      body: "Three",
      raw: { id: "item-3", type: "agentMessage" },
    };

    expect(countTimelineEntries(thread)).toBe(3);
    expect(selectTimelineWindow(thread, 2).map((entry) => entry.id)).toEqual(["item-2", "item-3"]);
    expect(selectTimeline(thread).map((entry) => entry.id)).toEqual(["item-1", "item-2", "item-3"]);
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

  it("stores git snapshots by workspace without forcing a new file selection", () => {
    const store = useWorkbenchStore.getState();
    store.setWorkspaceGitSnapshot(makeGitSnapshot());

    const state = useWorkbenchStore.getState();
    expect(state.gitSnapshotsByWorkspaceId["workspace-1"]?.files).toHaveLength(2);
    expect(state.selectedGitFileByWorkspaceId["workspace-1"]).toBeNull();
  });

  it("keeps a valid selected git file when the workspace snapshot refreshes", () => {
    const store = useWorkbenchStore.getState();
    store.setWorkspaceGitSnapshot(makeGitSnapshot());
    store.selectWorkspaceGitFile("workspace-1", "README.md");
    store.setWorkspaceGitSnapshot(
      makeGitSnapshot({
        files: [
          {
            path: "README.md",
            status: "modified",
            staged: false,
            unstaged: true,
            additions: 2,
            deletions: 1,
            patch: "diff --git a/README.md b/README.md\n+updated",
            oldPath: null,
          },
        ],
      }),
    );

    expect(useWorkbenchStore.getState().selectedGitFileByWorkspaceId["workspace-1"]).toBe(
      "README.md",
    );
  });

  it("tracks realtime sessions, rebuilds audio URLs, and replaces older sessions", () => {
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    const createObjectURL = vi
      .fn()
      .mockReturnValueOnce("blob:realtime-1")
      .mockReturnValueOnce("blob:realtime-2");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: revokeObjectURL,
    });
    const store = useWorkbenchStore.getState();

    store.startRealtimeSession("thread-1", "session-1");
    store.appendRealtimeItem("thread-1", {
      type: "transcript",
      text: "Realtime hello",
    });
    store.appendRealtimeAudio("thread-1", {
      data: Buffer.from(new Int16Array([0, 512]).buffer).toString("base64"),
      sampleRate: 16_000,
      numChannels: 1,
      samplesPerChannel: 2,
    });

    vi.advanceTimersByTime(500);

    let session = useWorkbenchStore.getState().realtimeSessionsByThreadId["thread-1"];
    expect(session.sessionId).toBe("session-1");
    expect(session.items[0]?.textPreview).toBe("Realtime hello");
    expect(session.audio.objectUrl).toBe("blob:realtime-1");

    store.startRealtimeSession("thread-1", "session-2");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:realtime-1");

    store.appendRealtimeAudio("thread-1", {
      data: Buffer.from(new Int16Array([256, -256]).buffer).toString("base64"),
      sampleRate: 16_000,
      numChannels: 1,
      samplesPerChannel: 2,
    });
    store.closeRealtimeSession("thread-1", "done");

    session = useWorkbenchStore.getState().realtimeSessionsByThreadId["thread-1"];
    expect(session.status).toBe("closed");
    expect(session.closeReason).toBe("done");
    expect(session.audio.objectUrl).toBe("blob:realtime-2");
    expect(createObjectURL).toHaveBeenCalledTimes(2);

    if (originalCreateObjectURL) {
      Object.defineProperty(URL, "createObjectURL", {
        configurable: true,
        writable: true,
        value: originalCreateObjectURL,
      });
    } else {
      Reflect.deleteProperty(URL, "createObjectURL");
    }

    if (originalRevokeObjectURL) {
      Object.defineProperty(URL, "revokeObjectURL", {
        configurable: true,
        writable: true,
        value: originalRevokeObjectURL,
      });
    } else {
      Reflect.deleteProperty(URL, "revokeObjectURL");
    }
  });

  it("keeps realtime transcript visible when audio decoding fails", () => {
    const store = useWorkbenchStore.getState();

    store.startRealtimeSession("thread-1", "session-1");
    store.appendRealtimeItem("thread-1", {
      kind: "assistant.transcript",
      transcript: "Still visible",
    });
    store.appendRealtimeAudio("thread-1", {
      data: "AQ==",
      sampleRate: 16_000,
      numChannels: 1,
      samplesPerChannel: 1,
    });

    const session = useWorkbenchStore.getState().realtimeSessionsByThreadId["thread-1"];
    expect(session.items[0]?.textPreview).toBe("Still visible");
    expect(String(session.audio.decodeError)).toMatch(/PCM16 bytes/i);
    expect(session.audio.objectUrl).toBeNull();
  });
});
