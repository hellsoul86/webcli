import { randomUUID } from "node:crypto";
import { basename, join } from "node:path";
import type {
  AccountSummary,
  ApprovalPolicy,
  ConfigSnapshot,
  FuzzySearchSnapshot,
  IntegrationSnapshot,
  ModelOption,
  PendingApproval,
  ReasoningEffort,
  RuntimeStatus,
  SandboxMode,
  TimelineEntry,
} from "@webcli/contracts";
import type {
  RuntimeThreadConfig,
  RuntimeThreadRecord,
  RuntimeTurnRecord,
  SessionRuntime,
  SessionRuntimeEvent,
  SessionRuntimeListener,
} from "@webcli/core";

type FakeCommandRecord = {
  processId: string;
  command: string;
  cwd: string;
  completed: boolean;
  timers: Array<NodeJS.Timeout>;
};

export class FakeRuntime implements SessionRuntime {
  private readonly listeners = new Set<SessionRuntimeListener>();
  private readonly threads = new Map<string, RuntimeThreadRecord>();
  private readonly commands = new Map<string, FakeCommandRecord>();
  private readonly pendingApprovals = new Map<string, PendingApproval>();
  private readonly timers = new Set<NodeJS.Timeout>();
  private readonly startedAt = Math.floor(Date.now() / 1000);

  private config: ConfigSnapshot = {
    model: "gpt-5-codex",
    reasoningEffort: "xhigh",
    approvalPolicy: "on-request",
    sandboxMode: "danger-full-access",
  };

  private readonly status: RuntimeStatus = {
    connected: true,
    childPid: 4242,
    authenticated: true,
    requiresOpenaiAuth: false,
    restartCount: 0,
    lastError: null,
  };

  private readonly account: AccountSummary = {
    authenticated: true,
    requiresOpenaiAuth: false,
    accountType: "chatgpt",
    email: "fake-runtime@example.com",
    planType: "enterprise",
  };

  private readonly models: Array<ModelOption> = [
    {
      id: "gpt-5-codex",
      model: "gpt-5-codex",
      displayName: "GPT-5 Codex",
      description: "Fake runtime default",
      upgradeModel: "gpt-5-codex-spark",
      supportedReasoningEfforts: [
        { reasoningEffort: "low", description: "Low reasoning effort" },
        { reasoningEffort: "medium", description: "Medium reasoning effort" },
        { reasoningEffort: "high", description: "High reasoning effort" },
        { reasoningEffort: "xhigh", description: "Extra high reasoning effort" },
      ],
      defaultReasoningEffort: "high",
      hidden: false,
      isDefault: true,
    },
    {
      id: "gpt-5-codex-spark",
      model: "gpt-5-codex-spark",
      displayName: "GPT-5 Codex Spark",
      description: "Fake runtime fast upgrade",
      upgradeModel: null,
      supportedReasoningEfforts: [
        { reasoningEffort: "low", description: "Low reasoning effort" },
        { reasoningEffort: "medium", description: "Medium reasoning effort" },
        { reasoningEffort: "high", description: "High reasoning effort" },
      ],
      defaultReasoningEffort: "medium",
      hidden: false,
      isDefault: false,
    },
  ];

  constructor(private readonly projectRoot: string) {}

  async start(): Promise<void> {
    this.emit({
      type: "status.changed",
      status: this.getStatus(),
    });
  }

  async stop(): Promise<void> {
    for (const timer of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.commands.clear();
    this.pendingApprovals.clear();
  }

  subscribe(listener: SessionRuntimeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getStatus(): RuntimeStatus {
    return { ...this.status };
  }

  async getAccountSummary(): Promise<AccountSummary> {
    return { ...this.account };
  }

  async listModels(): Promise<Array<ModelOption>> {
    return this.models.map((model) => ({ ...model }));
  }

  async listThreads(archived: boolean): Promise<Array<RuntimeThreadRecord>> {
    return [...this.threads.values()]
      .filter((thread) => thread.archived === archived)
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .map((thread) => cloneThread(thread));
  }

  async openThread(input: RuntimeThreadConfig): Promise<RuntimeThreadRecord> {
    const now = Math.floor(Date.now() / 1000);
    const thread: RuntimeThreadRecord = {
      id: randomUUID(),
      name: `Thread ${this.threads.size + 1}`,
      preview: "Ready for the next prompt",
      archived: false,
      cwd: input.cwd,
      createdAt: now,
      updatedAt: now,
      status: { type: "idle" },
      modelProvider: "openai",
      source: "appServer",
      agentNickname: null,
      agentRole: null,
      gitInfo: null,
      path: null,
      ephemeral: false,
      turns: [],
    };

    this.threads.set(thread.id, thread);
    return cloneThread(thread);
  }

  async resumeThread(threadId: string): Promise<RuntimeThreadRecord> {
    return cloneThread(this.requireThread(threadId));
  }

  async renameThread(threadId: string, name: string): Promise<void> {
    const thread = this.requireThread(threadId);
    thread.name = name;
    thread.updatedAt = Math.floor(Date.now() / 1000);
    this.emit({
      type: "thread.name.changed",
      threadId,
      name,
    });
  }

  async archiveThread(threadId: string): Promise<void> {
    const thread = this.requireThread(threadId);
    thread.archived = true;
    thread.updatedAt = Math.floor(Date.now() / 1000);
    this.emit({
      type: "thread.archive.changed",
      threadId,
      archived: true,
    });
  }

  async unarchiveThread(threadId: string): Promise<RuntimeThreadRecord> {
    const thread = this.requireThread(threadId);
    thread.archived = false;
    thread.updatedAt = Math.floor(Date.now() / 1000);
    this.emit({
      type: "thread.archive.changed",
      threadId,
      archived: false,
    });
    return cloneThread(thread);
  }

  async forkThread(threadId: string, cwd: string): Promise<RuntimeThreadRecord> {
    const base = this.requireThread(threadId);
    const now = Math.floor(Date.now() / 1000);
    const forked: RuntimeThreadRecord = {
      ...cloneThread(base),
      id: randomUUID(),
      name: `${base.name ?? "Thread"} (fork)`,
      archived: false,
      cwd,
      createdAt: now,
      updatedAt: now,
    };
    this.threads.set(forked.id, forked);
    return cloneThread(forked);
  }

  async compactThread(): Promise<void> {}

  async rollbackThread(threadId: string): Promise<RuntimeThreadRecord> {
    return cloneThread(this.requireThread(threadId));
  }

  async startTurn(
    threadId: string,
    prompt: string,
    effort?: ReasoningEffort | null,
  ): Promise<RuntimeTurnRecord> {
    const thread = this.requireThread(threadId);
    if (effort !== undefined) {
      this.config.reasoningEffort = effort ?? null;
    }
    const turnId = randomUUID();
    const userItem = makeTimelineEntry({
      id: randomUUID(),
      turnId,
      kind: "userMessage",
      title: "You",
      body: prompt,
      raw: { prompt },
    });
    const turn: RuntimeTurnRecord = {
      id: turnId,
      status: "in_progress",
      errorMessage: null,
      items: [userItem],
    };

    thread.turns = [...thread.turns, cloneTurn(turn)];
    thread.preview = prompt;
    thread.updatedAt = Math.floor(Date.now() / 1000);

    const replyItemId = randomUUID();
    const approvalId = `approval-${randomUUID()}`;
    const approval: PendingApproval = {
      id: approvalId,
      method: "item/commandExecution/requestApproval",
      threadId,
      turnId,
      itemId: replyItemId,
      params: {
        command: "npm test",
      },
    };
    this.pendingApprovals.set(String(approval.id), approval);

    this.emit({
      type: "thread.status.changed",
      threadId,
      status: {
        type: "active",
        activeFlags: ["streaming"],
      },
    });

    this.schedule(() => {
      this.emit({
        type: "timeline.item",
        threadId,
        item: makeTimelineEntry({
          id: randomUUID(),
          turnId,
          kind: "reasoning",
          title: "Reasoning",
          body: "检查当前 workspace 状态。\n确认线程和审批归属。\n准备生成最终回复。",
          raw: {
            id: randomUUID(),
            type: "reasoning",
            summary: ["检查当前 workspace 状态。"],
            content: ["确认线程和审批归属。", "准备生成最终回复。"],
          },
        }),
      });
    }, 20);

    this.schedule(() => {
      this.emit({
        type: "timeline.item",
        threadId,
        item: makeTimelineEntry({
          id: randomUUID(),
          turnId,
          kind: "fileChange",
          title: "File Change",
          body: "update: README.md",
          raw: {
            id: randomUUID(),
            type: "fileChange",
            status: "completed",
            changes: [
              {
                path: join(this.projectRoot, "README.md"),
                kind: { type: "update", move_path: null },
                diff: `+Handled prompt: ${prompt}`,
              },
            ],
          },
        }),
      });
    }, 30);

    this.schedule(() => {
      this.emit({
        type: "timeline.delta",
        threadId,
        item: makeTimelineEntry({
          id: replyItemId,
          turnId,
          kind: "agentMessage",
          title: "Codex",
          body: "READY",
          raw: {
            id: replyItemId,
            type: "agentMessage",
          },
        }),
      });
    }, 40);

    this.schedule(() => {
      this.emit({
        type: "diff.updated",
        threadId,
        diff: `diff --git a/README.md b/README.md\n+Handled prompt: ${prompt}`,
      });
      this.emit({
        type: "plan.updated",
        threadId,
        explanation: "Fake runtime execution plan",
        plan: [
          { step: "Inspect bootstrap data", status: "completed" },
          { step: "Queue approval for the owning session", status: "in_progress" },
        ],
      });
      this.emit({
        type: "approval.requested",
        approval,
      });
    }, 80);

    return cloneTurn(turn);
  }

  async interruptTurn(threadId: string): Promise<void> {
    this.emit({
      type: "thread.status.changed",
      threadId,
      status: { type: "idle" },
    });
  }

  async steerTurn(threadId: string, turnId: string, prompt: string): Promise<void> {
    this.emit({
      type: "timeline.delta",
      threadId,
      item: makeTimelineEntry({
        id: randomUUID(),
        turnId,
        kind: "agentMessage",
        title: "Codex",
        body: `\nSteered with: ${prompt}`,
        raw: {
          prompt,
        },
      }),
    });
  }

  async startReview(threadId: string): Promise<RuntimeTurnRecord | null> {
    const thread = this.requireThread(threadId);
    const turnId = randomUUID();
    const turn: RuntimeTurnRecord = {
      id: turnId,
      status: "completed",
      errorMessage: null,
      items: [
        makeTimelineEntry({
          id: randomUUID(),
          turnId,
          kind: "enteredReviewMode",
          title: "Review",
          body: "Entering review mode",
          raw: {
            type: "enteredReviewMode",
          },
        }),
      ],
    };
    thread.turns = [...thread.turns, cloneTurn(turn)];
    thread.updatedAt = Math.floor(Date.now() / 1000);

    this.schedule(() => {
      this.emit({
        type: "review.updated",
        threadId,
        review: {
          findings: [
            {
              title: "Fake runtime finding",
              body: "Review output is wired through the new app-level contract.",
              confidence_score: 0.91,
              priority: 1,
              code_location: {
                absolute_file_path: join(thread.cwd, "package.json"),
                line_range: {
                  start: 1,
                  end: 1,
                },
              },
            },
          ],
          overall_correctness: "patch is correct",
          overall_explanation: "Fake runtime review completed successfully.",
          overall_confidence_score: 0.88,
        },
      });
    }, 30);

    return cloneTurn(turn);
  }

  async startCommand(input: {
    processId: string;
    command: string;
    cwd: string;
    cols: number;
    rows: number;
  }): Promise<void> {
    const record: FakeCommandRecord = {
      processId: input.processId,
      command: input.command,
      cwd: input.cwd,
      completed: false,
      timers: [],
    };
    this.commands.set(input.processId, record);

    record.timers.push(
      this.schedule(() => {
        this.emit({
          type: "command.output",
          processId: input.processId,
          stream: "stdout",
          text: renderCommandOutput(input.command, input.cwd),
        });
      }, 30),
    );
    record.timers.push(
      this.schedule(() => {
        this.completeCommand(input.processId, {
          status: "completed",
          exitCode: 0,
          stdout: "",
          stderr: "",
        });
      }, 70),
    );
  }

  async writeCommand(processId: string, text: string): Promise<void> {
    if (!this.commands.has(processId)) {
      return;
    }

    this.emit({
      type: "command.output",
      processId,
      stream: "stdout",
      text,
    });
  }

  async resizeCommand(): Promise<void> {}

  async stopCommand(processId: string): Promise<void> {
    this.completeCommand(processId, {
      status: "completed",
      exitCode: 0,
      stdout: "",
      stderr: "",
    });
  }

  async readConfigSnapshot(): Promise<ConfigSnapshot | null> {
    return { ...this.config };
  }

  async getIntegrationSnapshot(): Promise<IntegrationSnapshot> {
    return {
      authStatus: {
        authMethod: "chatgpt",
        requiresOpenaiAuth: false,
      },
      config: { ...this.config },
      mcpServers: [
        {
          name: "filesystem",
          authStatus: "connected",
          toolsCount: 3,
          resourcesCount: 1,
        },
      ],
      skills: [
        {
          cwd: this.projectRoot,
          skills: [{ name: "playwright" }],
          errors: [],
        },
      ],
      apps: [],
      plugins: [
        {
          path: join(this.projectRoot, "plugins"),
          name: "Local plugins",
          plugins: [
            {
              id: "fake-plugin",
              name: "Fake Plugin",
              installed: true,
              enabled: true,
            },
          ],
        },
      ],
    };
  }

  async saveSettings(input: ConfigSnapshot): Promise<void> {
    this.config = { ...input };
  }

  async loginMcp(name: string): Promise<string> {
    return `https://example.com/oauth/${encodeURIComponent(name)}`;
  }

  async reloadMcp(): Promise<void> {}

  async uninstallPlugin(): Promise<void> {}

  async searchFiles(input: { query: string; roots: Array<string> }): Promise<FuzzySearchSnapshot> {
    const query = input.query.trim().toLowerCase();
    const root = input.roots[0] ?? this.projectRoot;
    const candidates = [
      join(root, "package.json"),
      join(root, "apps/web/src/App.tsx"),
      join(root, "apps/server/src/app.ts"),
      join(root, "packages/contracts/src/ws.ts"),
    ];
    const results = candidates
      .filter((candidate) => candidate.toLowerCase().includes(query))
      .map((candidate, index) => ({
        path: candidate,
        score: Number((1 - index * 0.1).toFixed(2)),
      }));

    return {
      sessionId: randomUUID(),
      query: input.query,
      status: "completed",
      results,
    };
  }

  async resolveApproval(
    approval: PendingApproval,
    decision: "accept" | "decline",
  ): Promise<void> {
    this.pendingApprovals.delete(String(approval.id));
    if (!approval.threadId || !approval.turnId) {
      return;
    }

    this.emit({
      type: "timeline.delta",
      threadId: approval.threadId,
      item: makeTimelineEntry({
        id: randomUUID(),
        turnId: approval.turnId,
        kind: "agentMessage",
        title: "Codex",
        body: `\nApproval ${decision === "accept" ? "accepted" : "declined"}.`,
        raw: {
          decision,
        },
      }),
    });
    this.emit({
      type: "thread.status.changed",
      threadId: approval.threadId,
      status: { type: "idle" },
    });
  }

  private emit(event: SessionRuntimeEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private requireThread(threadId: string): RuntimeThreadRecord {
    const thread = this.threads.get(threadId);
    if (!thread) {
      throw new Error(`Unknown thread: ${threadId}`);
    }
    return thread;
  }

  private schedule(callback: () => void, delay = 20): NodeJS.Timeout {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      callback();
    }, delay);
    this.timers.add(timer);
    return timer;
  }

  private completeCommand(
    processId: string,
    payload: { status: "completed" | "failed"; exitCode: number | null; stdout: string; stderr: string },
  ): void {
    const record = this.commands.get(processId);
    if (!record || record.completed) {
      return;
    }

    record.completed = true;
    for (const timer of record.timers) {
      clearTimeout(timer);
      this.timers.delete(timer);
    }
    record.timers = [];
    this.commands.delete(processId);
    this.emit({
      type: "command.completed",
      processId,
      session: payload,
    });
  }
}

function cloneThread(thread: RuntimeThreadRecord): RuntimeThreadRecord {
  return {
    ...thread,
    turns: thread.turns.map((turn) => cloneTurn(turn)),
  };
}

function cloneTurn(turn: RuntimeTurnRecord): RuntimeTurnRecord {
  return {
    ...turn,
    items: turn.items.map((item) => ({ ...item })),
  };
}

function makeTimelineEntry(input: TimelineEntry): TimelineEntry {
  return { ...input };
}

function renderCommandOutput(command: string, cwd: string): string {
  if (command.trim() === "pwd") {
    return `${cwd}\n`;
  }

  const printfMatch = command.match(/printf\s+'([^']+)'/);
  if (printfMatch) {
    return printfMatch[1].replaceAll("\\n", "\n");
  }

  if (command.trim() === "ls") {
    return `package.json\napps\npackages\n`;
  }

  return `fake runtime executed: ${basename(cwd)}$ ${command}\n`;
}
