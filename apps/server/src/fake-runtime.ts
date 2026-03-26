import { randomUUID } from "node:crypto";
import { basename, join } from "node:path";
import type {
  AccountRateLimitsSnapshot,
  AccountLoginCancelStatus,
  AccountLoginStartInput,
  AccountLoginStartResponse,
  AccountStateSnapshot,
  AccountSummary,
  AppInstallHint,
  AppSnapshot,
  ApprovalPolicy,
  ConfigBatchWriteInput,
  ConfigBatchWriteResult,
  ConfigRequirementsSnapshot,
  ConfigSnapshot,
  ConversationSummarySnapshot,
  ExperimentalFeatureSnapshot,
  ExternalAgentConfigDetectInput,
  ExternalAgentConfigMigrationItem,
  FuzzySearchSnapshot,
  GitBranchReference,
  GitFileReviewDetail,
  GitRemoteDiffSnapshot,
  GitWorkingTreeFile,
  GitWorkingTreeSnapshot,
  HazelnutScope,
  IntegrationSnapshot,
  ModelOption,
  McpServerSnapshot,
  PendingApproval,
  PluginMarketplaceSnapshot,
  ProductSurface,
  ReasoningEffort,
  RealtimeAudioChunk,
  RemoteSkillExportResult,
  RemoteSkillSummary,
  RuntimeStatus,
  SandboxMode,
  ServerRequestResolveInput,
  ThreadMetadataGitInfoUpdate,
  SkillGroupSnapshot,
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
  private readonly gitBranchByCwd = new Map<string, string>();
  private readonly startedAt = Math.floor(Date.now() / 1000);

  private config: ConfigSnapshot = {
    model: "gpt-5-codex",
    reasoningEffort: "xhigh",
    serviceTier: null,
    approvalPolicy: "on-request",
    sandboxMode: "danger-full-access",
    forcedLoginMethod: null,
  };

  private status: RuntimeStatus = {
    connected: true,
    childPid: 4242,
    authenticated: true,
    requiresOpenaiAuth: false,
    restartCount: 0,
    lastError: null,
  };

  private account: AccountSummary = {
    authenticated: true,
    requiresOpenaiAuth: false,
    accountType: "chatgpt",
    email: "fake-runtime@example.com",
    planType: "enterprise",
    usageWindows: [
      {
        label: "5h",
        remainingPercent: 82,
        usedPercent: 18,
        resetsAt: Math.floor(Date.now() / 1000) + 18_000,
      },
      {
        label: "1w",
        remainingPercent: 61,
        usedPercent: 39,
        resetsAt: Math.floor(Date.now() / 1000) + 604_800,
      },
    ],
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

  private experimentalFeatures: Array<ExperimentalFeatureSnapshot> = [
    {
      name: "multi_agent",
      stage: "beta",
      displayName: "Multi-agent",
      description: "Run scoped sub-agents for bounded tasks.",
      announcement: "Lets Codex delegate sidecar tasks without leaving the current workflow.",
      enabled: true,
      defaultEnabled: false,
    },
    {
      name: "apps",
      stage: "stable",
      displayName: "Apps",
      description: "Expose installed app connectors directly in the workbench.",
      announcement: null,
      enabled: true,
      defaultEnabled: true,
    },
    {
      name: "prevent_idle_sleep",
      stage: "underDevelopment",
      displayName: "Prevent idle sleep",
      description: "Keep the host awake while long-running Codex tasks are active.",
      announcement: "Useful for unattended review and deploy sessions.",
      enabled: false,
      defaultEnabled: false,
    },
  ];

  constructor(private readonly projectRoot: string) {
    this.seedThreadFromEnvironment();
  }

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

  async readAccountState(): Promise<AccountStateSnapshot> {
    return {
      account: { ...this.account },
      authStatus: {
        authMethod:
          this.account.accountType === "chatgpt"
            ? "chatgpt"
            : this.account.accountType === "apiKey"
              ? "apikey"
              : null,
        requiresOpenaiAuth: this.account.requiresOpenaiAuth,
      },
    };
  }

  async readAccountRateLimits(): Promise<AccountRateLimitsSnapshot> {
    return {
      rateLimits: {
        primary: {
          windowDurationMins: 300,
          usedPercent: 18,
          remainingPercent: 82,
          resetsAt: Date.now() + 18_000,
        },
        secondary: {
          windowDurationMins: 10_080,
          usedPercent: 39,
          remainingPercent: 61,
          resetsAt: Date.now() + 604_800,
        },
      },
      rateLimitsByLimitId: {},
    };
  }

  async readConversationSummary(
    input: { conversationId: string } | { rolloutPath: string },
  ): Promise<ConversationSummarySnapshot> {
    const thread =
      "conversationId" in input
        ? this.requireThread(input.conversationId)
        : [...this.threads.values()].find((entry) => getFakeThreadRolloutPath(entry) === input.rolloutPath);

    if (!thread) {
      throw new Error("Conversation not found");
    }

    return makeFakeConversationSummary(thread, this.gitBranchByCwd.get(thread.cwd) ?? "main");
  }

  async loginAccount(input: AccountLoginStartInput): Promise<AccountLoginStartResponse> {
    if (input.type === "chatgpt") {
      return {
        type: "chatgpt",
        loginId: randomUUID(),
        authUrl: "https://example.com/login",
      };
    }

    if (input.type === "deviceCode") {
      return {
        type: "deviceCode",
        loginId: randomUUID(),
        verificationUrl: "https://auth.openai.com/codex/device",
        userCode: "ABCD-EFGH",
        expiresAt: Date.now() + 15 * 60_000,
      };
    }

    this.account = {
      ...this.account,
      authenticated: true,
      requiresOpenaiAuth: false,
      accountType: input.type === "apiKey" ? "apiKey" : "chatgpt",
      email: input.type === "apiKey" ? null : "fake-runtime@example.com",
      planType: input.type === "apiKey" ? null : "enterprise",
    };
    this.status = {
      ...this.status,
      authenticated: true,
      requiresOpenaiAuth: false,
    };
    this.emit({ type: "account.updated", account: { ...this.account } });
    return { type: input.type };
  }

  async cancelAccountLogin(): Promise<AccountLoginCancelStatus> {
    return "canceled";
  }

  async logoutAccount(): Promise<void> {
    this.account = {
      authenticated: false,
      requiresOpenaiAuth: true,
      accountType: "unknown",
      email: null,
      planType: null,
      usageWindows: [],
    };
    this.status = {
      ...this.status,
      authenticated: false,
      requiresOpenaiAuth: true,
    };
    this.emit({ type: "account.updated", account: { ...this.account } });
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

  async readThread(threadId: string): Promise<RuntimeThreadRecord> {
    return cloneThread(this.requireThread(threadId));
  }

  async listLoadedThreadIds(): Promise<Array<string>> {
    return [...this.threads.values()]
      .filter((thread) => !thread.archived)
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .map((thread) => thread.id);
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

  async updateThreadMetadata(
    threadId: string,
    input: { gitInfo?: ThreadMetadataGitInfoUpdate | null },
  ): Promise<RuntimeThreadRecord> {
    const thread = this.requireThread(threadId);
    thread.gitInfo =
      input.gitInfo === undefined
        ? thread.gitInfo
        : input.gitInfo === null
          ? null
          : {
              ...(thread.gitInfo && typeof thread.gitInfo === "object" ? thread.gitInfo as Record<string, unknown> : {}),
              ...(input.gitInfo.originUrl !== undefined ? { originUrl: input.gitInfo.originUrl } : {}),
              ...(input.gitInfo.branch !== undefined ? { branch: input.gitInfo.branch } : {}),
              ...(input.gitInfo.sha !== undefined ? { sha: input.gitInfo.sha } : {}),
            };
    thread.updatedAt = Math.floor(Date.now() / 1000);
    this.emit({
      type: "thread.updated",
      thread: cloneThread(thread),
    });
    return cloneThread(thread);
  }

  async unsubscribeThread(
    threadId: string,
  ): Promise<"notLoaded" | "notSubscribed" | "unsubscribed"> {
    const thread = this.requireThread(threadId);
    if (thread.status.type === "notLoaded") {
      return "notLoaded";
    }
    thread.status = { type: "notLoaded" };
    thread.updatedAt = Math.floor(Date.now() / 1000);
    this.emit({
      type: "thread.closed",
      threadId,
    });
    return "unsubscribed";
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

  async archiveThread(threadId: string, _path?: string | null): Promise<void> {
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
      tokenUsage: null,
      items: [userItem],
    };

    thread.turns = [...thread.turns, cloneTurn(turn)];
    thread.preview = prompt;
    thread.updatedAt = Math.floor(Date.now() / 1000);

    const replyItemId = randomUUID();
    const approval = buildFakePendingApproval(threadId, turnId, replyItemId, prompt);
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

    if (prompt.startsWith("timeline-parity:")) {
      this.schedule(() => {
        this.emit({
          type: "timeline.item",
          threadId,
          item: makeTimelineEntry({
            id: randomUUID(),
            turnId,
            kind: "rawResponseItem",
            title: "Response Message",
            body: "Raw response hello",
            raw: {
              type: "rawResponseItem",
              responseItemType: "message",
              responseItem: {
                type: "message",
                role: "assistant",
                content: [{ type: "output_text", text: "Raw response hello" }],
              },
            },
          }),
        });
      }, 35);

      this.schedule(() => {
        this.emit({
          type: "timeline.item",
          threadId,
          item: makeTimelineEntry({
            id: randomUUID(),
            turnId,
            kind: "commandExecution",
            title: "Command",
            body: "npm test -- --runInBand",
            raw: {
              id: randomUUID(),
              type: "commandExecution",
              command: "npm test -- --runInBand",
              cwd: thread.cwd,
              processId: "fake-process-1",
              status: "completed",
              commandActions: [],
              aggregatedOutput: "1 passed",
              exitCode: 0,
              durationMs: 240,
            },
          }),
        });
      }, 45);

      this.schedule(() => {
        this.emit({
          type: "timeline.item",
          threadId,
          item: makeTimelineEntry({
            id: randomUUID(),
            turnId,
            kind: "commandExecutionInteraction",
            title: "Terminal Input",
            body: "y\n",
            raw: {
              type: "commandExecutionInteraction",
              itemId: "fake-command-item",
              processId: "fake-process-1",
              stdin: "y\n",
            },
          }),
        });
      }, 55);
    }

    if (prompt.startsWith("realtime-smoke:")) {
      this.schedule(() => {
        this.emit({
          type: "thread.realtime.started",
          threadId,
          sessionId: `realtime-session-${turnId}`,
        });
      }, 35);

      this.schedule(() => {
        this.emit({
          type: "thread.realtime.itemAdded",
          threadId,
          item: {
            id: `rt-item-${turnId}-1`,
            type: "transcript",
            text: "Realtime hello",
          },
        });
      }, 60);

      this.schedule(() => {
        this.emit({
          type: "thread.realtime.outputAudio.delta",
          threadId,
          audio: makeRealtimeAudioChunk([0, 2048, -2048, 1024]),
        });
      }, 100);

      this.schedule(() => {
        this.emit({
          type: "thread.realtime.itemAdded",
          threadId,
          item: {
            id: `rt-item-${turnId}-2`,
            kind: "assistant.transcript",
            transcript: "Second realtime line",
          },
        });
      }, 140);

      this.schedule(() => {
        this.emit({
          type: "thread.realtime.outputAudio.delta",
          threadId,
          audio: makeRealtimeAudioChunk([512, -512, 1536, -1536]),
        });
      }, 180);

      this.schedule(() => {
        this.emit({
          type: "thread.realtime.closed",
          threadId,
          reason: "session-finished",
        });
        this.emit({
          type: "thread.status.changed",
          threadId,
          status: { type: "idle" },
        });
      }, 230);

      return cloneTurn(turn);
    }

    const replyChunks = prompt.startsWith("stream-")
      ? ["RE", "ADY ", prompt]
      : ["RE", "AD", "Y"];
    replyChunks.forEach((chunk, index) => {
      this.schedule(() => {
        this.emit({
          type: "timeline.delta",
          threadId,
          item: makeTimelineEntry({
            id: replyItemId,
            turnId,
            kind: "agentMessage",
            title: "Codex",
            body: chunk,
            raw: {
              id: replyItemId,
              type: "agentMessage",
            },
          }),
        });
      }, 40 + index * 220);
    });

    this.schedule(() => {
      this.emit({
        type: "diff.updated",
        threadId,
        diff: `diff --git a/README.md b/README.md\n+Handled prompt: ${prompt}`,
      });
      this.emit({
        type: "plan.updated",
        threadId,
        turnId,
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
    }, 560);

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
      tokenUsage: null,
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

  async readConfigRequirements(): Promise<ConfigRequirementsSnapshot | null> {
    return null;
  }

  async getIntegrationSnapshot(): Promise<IntegrationSnapshot> {
    const authMethod =
      this.account.accountType === "chatgpt"
        ? "chatgpt"
        : this.account.accountType === "apiKey"
          ? "apikey"
          : null;

    return {
      authStatus: {
        authMethod,
        requiresOpenaiAuth: this.account.requiresOpenaiAuth,
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
          skills: [
            {
              name: "playwright",
              description: "Drive a browser from the shell.",
              shortDescription: "Browser automation",
              path: join(this.projectRoot, ".codex/skills/playwright"),
              enabled: true,
            },
          ],
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

  async batchWriteConfig(input: ConfigBatchWriteInput): Promise<ConfigBatchWriteResult> {
    for (const edit of input.edits) {
      if (!edit.keyPath.startsWith("features.")) {
        continue;
      }

      const name = edit.keyPath.slice("features.".length);
      const enabled = Boolean(edit.value);
      const existing = this.experimentalFeatures.find((feature) => feature.name === name);

      if (existing) {
        existing.enabled = enabled;
        continue;
      }

      this.experimentalFeatures.push({
        name,
        stage: "underDevelopment",
        displayName: null,
        description: null,
        announcement: null,
        enabled,
        defaultEnabled: false,
      });
    }

    return {
      status: "ok",
      version: "fake-runtime",
      filePath: join(this.projectRoot, ".codex", "config.toml"),
      overriddenMessage: null,
    };
  }

  async detectExternalAgentConfig(
    _input: ExternalAgentConfigDetectInput,
  ): Promise<Array<ExternalAgentConfigMigrationItem>> {
    return [];
  }

  async importExternalAgentConfig(): Promise<void> {}

  async saveSettings(input: ConfigSnapshot): Promise<void> {
    this.config = { ...input };
  }

  async listExperimentalFeatures(input?: {
    cursor?: string | null;
    limit?: number | null;
  }): Promise<{ data: Array<ExperimentalFeatureSnapshot>; nextCursor: string | null }> {
    const start = Math.max(0, Number.parseInt(input?.cursor ?? "0", 10) || 0);
    const limit = input?.limit && input.limit > 0 ? input.limit : this.experimentalFeatures.length;
    const data = this.experimentalFeatures
      .slice(start, start + limit)
      .map((feature) => ({ ...feature }));

    return {
      data,
      nextCursor: start + limit < this.experimentalFeatures.length ? String(start + limit) : null,
    };
  }

  async readWorkspaceGitSnapshot(
    cwd: string,
    workspaceId: string,
    workspaceName: string,
  ): Promise<GitWorkingTreeSnapshot> {
    return makeGitSnapshot(
      workspaceId,
      workspaceName,
      cwd,
      this.gitBranchByCwd.get(cwd) ?? "main",
    );
  }

  async readWorkspaceGitBranches(cwd: string): Promise<{
    branches: Array<GitBranchReference>;
    currentBranch: string | null;
  }> {
    const currentBranch = this.gitBranchByCwd.get(cwd) ?? "main";
    return {
      currentBranch,
      branches: [
        { name: "main", current: currentBranch === "main" },
        { name: "develop", current: currentBranch === "develop" },
        { name: "release", current: currentBranch === "release" },
      ],
    };
  }

  async switchWorkspaceGitBranch(cwd: string, branch: string): Promise<void> {
    this.gitBranchByCwd.set(cwd, branch);
  }

  async readWorkspaceGitFileDetail(
    cwd: string,
    file: GitWorkingTreeFile,
  ): Promise<GitFileReviewDetail> {
    return makeGitFileReviewDetail(cwd, file);
  }

  async readGitDiffToRemote(cwd: string): Promise<GitRemoteDiffSnapshot> {
    return {
      cwd,
      sha: "a1b2c3d4",
      diff: [
        "diff --git a/README.md b/README.md",
        "index 1111111..2222222 100644",
        "--- a/README.md",
        "+++ b/README.md",
        "@@ -1,3 +1,5 @@",
        "-Old heading",
        "+# WebCLI",
        "+",
        "+Remote diff coverage",
      ].join("\n"),
    };
  }

  async loginMcp(name: string): Promise<string> {
    return `https://example.com/oauth/${encodeURIComponent(name)}`;
  }

  async reloadMcp(): Promise<void> {}

  async listMcpServerStatuses(): Promise<Array<McpServerSnapshot>> {
    return [
      {
        name: "filesystem",
        authStatus: "connected",
        toolsCount: 3,
        resourcesCount: 1,
      },
    ];
  }

  async listSkills(): Promise<Array<SkillGroupSnapshot>> {
    return [
      {
        cwd: this.projectRoot,
        skills: [
          {
            name: "playwright",
            description: "Drive a browser from the shell.",
            shortDescription: "Browser automation",
            path: join(this.projectRoot, ".codex/skills/playwright"),
            enabled: true,
          },
        ],
        errors: [],
      },
    ];
  }

  async listRemoteSkills(_input: {
    hazelnutScope: HazelnutScope;
    productSurface: ProductSurface;
    enabled: boolean;
  }): Promise<Array<RemoteSkillSummary>> {
    return [
      {
        id: "remote-playwright",
        name: "Remote Playwright",
        description: "Shared browser automation skill.",
      },
    ];
  }

  async exportRemoteSkill(hazelnutId: string): Promise<RemoteSkillExportResult> {
    return {
      id: hazelnutId,
      path: join(this.projectRoot, ".codex/skills", hazelnutId),
    };
  }

  async writeSkillConfig(_path: string, enabled: boolean): Promise<{ effectiveEnabled: boolean }> {
    return { effectiveEnabled: enabled };
  }

  async listApps(): Promise<Array<AppSnapshot>> {
    return [
      {
        id: "github",
        name: "GitHub",
        description: "Connector",
        isAccessible: true,
        isEnabled: true,
        pluginDisplayNames: ["Fake Plugin"],
        installUrl: "https://example.com/install/github",
      },
    ];
  }

  async listPlugins(): Promise<Array<PluginMarketplaceSnapshot>> {
    return [
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
    ];
  }

  async installPlugin(): Promise<{ appsNeedingAuth: Array<AppInstallHint> }> {
    return {
      appsNeedingAuth: [
        {
          id: "github",
          name: "GitHub",
          description: "Connector",
          installUrl: "https://example.com/install/github",
        },
      ],
    };
  }

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

  async resolveServerRequest(
    approval: PendingApproval,
    resolution: ServerRequestResolveInput,
  ): Promise<void> {
    this.pendingApprovals.delete(String(approval.id));
    if (!approval.threadId || !approval.turnId) {
      return;
    }

    const decision = summarizeResolution(resolution);

    this.emit({
      type: "timeline.delta",
      threadId: approval.threadId,
      item: makeTimelineEntry({
        id: randomUUID(),
        turnId: approval.turnId,
        kind: "agentMessage",
        title: "Codex",
        body: `\nDecision resolved: ${decision}.`,
        raw: {
          decision: resolution,
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

  private seedThreadFromEnvironment(): void {
    const seededCwd = process.env.WEBCLI_FAKE_EXTERNAL_THREAD_CWD?.trim();
    if (!seededCwd) {
      return;
    }

    const now = Math.floor(Date.now() / 1000);
    const thread: RuntimeThreadRecord = {
      id: "thread-external-seed",
      name: "Staging repo",
      preview: "Outside-home thread for sidebar coverage",
      archived: false,
      cwd: seededCwd,
      createdAt: now - 120,
      updatedAt: now - 60,
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

function getFakeThreadRolloutPath(thread: RuntimeThreadRecord): string {
  return thread.path ?? join(thread.cwd, ".codex", "threads", `${thread.id}.json`);
}

function makeFakeConversationSummary(
  thread: RuntimeThreadRecord,
  branch: string,
): ConversationSummarySnapshot {
  return {
    conversationId: thread.id,
    path: getFakeThreadRolloutPath(thread),
    preview: thread.preview,
    timestamp: new Date(thread.createdAt * 1000).toISOString(),
    updatedAt: new Date(thread.updatedAt * 1000).toISOString(),
    modelProvider: thread.modelProvider,
    cwd: thread.cwd,
    cliVersion: "0.114.0",
    source: "cli",
    gitInfo: {
      sha: "a1b2c3d4",
      branch,
      originUrl: "https://github.com/hellsoul86/webcli.git",
    },
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

function makeGitSnapshot(
  workspaceId: string,
  workspaceName: string,
  cwd: string,
  branch = "main",
): GitWorkingTreeSnapshot {
  return {
    workspaceId,
    workspaceName,
    repoRoot: cwd,
    branch,
    isGitRepository: true,
    clean: false,
    stagedCount: 2,
    unstagedCount: 5,
    untrackedCount: 1,
    generatedAt: Date.now(),
    files: [
      {
        path: "apps/web/src/App.tsx",
        status: "modified",
        staged: true,
        unstaged: true,
        additions: 9,
        deletions: 3,
        patch:
          "diff --git a/apps/web/src/App.tsx b/apps/web/src/App.tsx\n@@ -1,4 +1,7 @@\n-import { App } from \"./legacy\";\n+import { WorkbenchScreen } from \"./app/shell/WorkbenchScreen\";\n \n-export default App;\n+export default function App() {\n+  return <WorkbenchScreen />;\n+}\n",
        oldPath: null,
      },
      {
        path: "README.md",
        status: "modified",
        staged: false,
        unstaged: true,
        additions: 4,
        deletions: 1,
        patch:
          "diff --git a/README.md b/README.md\n@@ -1,3 +1,6 @@\n-Old heading\n+# WebCLI\n+\n+New review experience\n+\n+Extra context\n",
        oldPath: null,
      },
      {
        path: "docs/review/notes.md",
        status: "conflicted",
        staged: false,
        unstaged: true,
        additions: 7,
        deletions: 3,
        patch:
          "diff --cc docs/review/notes.md\nindex 1234567,89abcde..0000000\n--- a/docs/review/notes.md\n+++ b/docs/review/notes.md\n@@@ -1,3 -1,3 +1,8 @@@\n++<<<<<<< HEAD\n +Current note\n++=======\n+ Incoming note\n++>>>>>>> feature/review\n",
        oldPath: null,
      },
      {
        path: "packages/core/src/git-review-panel.ts",
        status: "renamed",
        staged: true,
        unstaged: false,
        additions: 6,
        deletions: 6,
        patch:
          "diff --git a/packages/core/src/git-panel.ts b/packages/core/src/git-review-panel.ts\nsimilarity index 72%\nrename from packages/core/src/git-panel.ts\nrename to packages/core/src/git-review-panel.ts\n@@ -1,3 +1,3 @@\n-export const legacyPanel = true;\n+export const reviewPanel = true;\n",
        oldPath: "packages/core/src/git-panel.ts",
      },
      {
        path: "src/deleted-file.ts",
        status: "deleted",
        staged: false,
        unstaged: true,
        additions: 0,
        deletions: 5,
        patch:
          "diff --git a/src/deleted-file.ts b/src/deleted-file.ts\ndeleted file mode 100644\n--- a/src/deleted-file.ts\n+++ /dev/null\n@@ -1,5 +0,0 @@\n-export const removed = true;\n-export function legacy() {\n-  return removed;\n-}\n-\n",
        oldPath: null,
      },
      {
        path: "src/new-file.ts",
        status: "untracked",
        staged: false,
        unstaged: true,
        additions: 3,
        deletions: 0,
        patch:
          "diff --git a/src/new-file.ts b/src/new-file.ts\nnew file mode 100644\n--- /dev/null\n+++ b/src/new-file.ts\n@@ -0,0 +1,3 @@\n+export const value = 1;\n+export const doubled = value * 2;\n+export const triple = value * 3;\n",
        oldPath: null,
      },
    ],
  };
}

function makeGitFileReviewDetail(cwd: string, file: GitWorkingTreeFile): GitFileReviewDetail {
  const language = inferFakeGitLanguage(file.path);

  switch (file.path) {
    case "apps/web/src/App.tsx":
      return {
        path: file.path,
        oldPath: file.oldPath ?? null,
        status: file.status,
        language,
        mode: "inline-diff",
        originalText: [
          "import { App } from \"./legacy\";",
          "",
          "export default App;",
        ].join("\n"),
        modifiedText: [
          "import { WorkbenchScreen } from \"./app/shell/WorkbenchScreen\";",
          "",
          "export default function App() {",
          "  return <WorkbenchScreen />;",
          "}",
        ].join("\n"),
      };
    case "README.md":
      return {
        path: file.path,
        oldPath: file.oldPath ?? null,
        status: file.status,
        language,
        mode: "inline-diff",
        originalText: ["Old heading", "", "Legacy content"].join("\n"),
        modifiedText: ["# WebCLI", "", "New review experience", "", "Extra context"].join("\n"),
      };
    case "packages/core/src/git-review-panel.ts":
      return {
        path: file.path,
        oldPath: file.oldPath ?? null,
        status: file.status,
        language,
        mode: "inline-diff",
        originalText: [
          "export const legacyPanel = true;",
          "export const legacyTitle = \"Git panel\";",
        ].join("\n"),
        modifiedText: [
          "export const reviewPanel = true;",
          "export const reviewTitle = \"Git review panel\";",
        ].join("\n"),
      };
    case "src/deleted-file.ts":
      return {
        path: file.path,
        oldPath: file.oldPath ?? null,
        status: file.status,
        language,
        mode: "inline-diff",
        originalText: [
          "export const removed = true;",
          "export function legacy() {",
          "  return removed;",
          "}",
        ].join("\n"),
        modifiedText: "",
      };
    case "src/new-file.ts":
      return {
        path: file.path,
        oldPath: file.oldPath ?? null,
        status: file.status,
        language,
        mode: "inline-diff",
        originalText: "",
        modifiedText: [
          "export const value = 1;",
          "export const doubled = value * 2;",
          "export const triple = value * 3;",
        ].join("\n"),
      };
    case "docs/review/notes.md":
      return {
        path: file.path,
        oldPath: file.oldPath ?? null,
        status: file.status,
        language,
        mode: "patch",
        patch: file.patch,
        reason: "Merge conflicts are shown as raw patch output.",
      };
    default:
      return {
        path: file.path,
        oldPath: file.oldPath ?? null,
        status: file.status,
        language,
        mode: "unavailable",
        patch: file.patch,
        reason: `No fake review detail fixture for ${cwd}/${file.path}`,
      };
  }
}

function inferFakeGitLanguage(path: string): string | null {
  const normalized = path.toLowerCase();
  if (normalized.endsWith(".tsx") || normalized.endsWith(".ts")) {
    return "typescript";
  }
  if (normalized.endsWith(".md")) {
    return "markdown";
  }
  return "plaintext";
}

function buildFakePendingApproval(
  threadId: string,
  turnId: string,
  itemId: string,
  prompt: string,
): PendingApproval {
  if (prompt.startsWith("request-user-input:")) {
    return {
      id: randomUUID(),
      kind: "requestUserInput",
      method: "item/tool/requestUserInput",
      threadId,
      turnId,
      itemId,
      params: {
        questions: [
          {
            id: "approval_mode",
            header: "Approval mode",
            question: "Choose how to proceed",
            isOther: false,
            isSecret: false,
            options: [
              { label: "accept", description: "Continue with the request" },
              { label: "decline", description: "Reject the request" },
            ],
          },
        ],
      },
    };
  }

  return {
    id: randomUUID(),
    kind: "commandExecutionApproval",
    method: "item/commandExecution/requestApproval",
    threadId,
    turnId,
    itemId,
    params: {
      command: "npm test",
      cwd: threadId.startsWith("thread-external") ? "/srv/webcli-staging/repo" : "/workspace",
      reason: "Fake runtime queued a command approval.",
      availableDecisions: ["accept", "acceptForSession", "decline"],
    },
  };
}

function summarizeResolution(resolution: ServerRequestResolveInput): string {
  switch (resolution.kind) {
    case "commandExecutionApproval":
    case "fileChangeApproval":
    case "applyPatchApproval":
    case "execCommandApproval":
      return String(resolution.resolution.decision);
    case "requestUserInput":
      return `answered ${Object.keys(resolution.resolution.answers).length} question(s)`;
    case "mcpServerElicitation":
      return resolution.resolution.action;
    case "permissionsApproval":
      return "permissions updated";
    case "dynamicToolCall":
      return resolution.resolution.success ? "tool succeeded" : "tool failed";
    case "chatgptAuthTokensRefresh":
      return `refreshed ${resolution.resolution.chatgptAccountId}`;
  }
}

function makeRealtimeAudioChunk(samples: Array<number>): RealtimeAudioChunk {
  const buffer = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => {
    buffer.writeInt16LE(sample, index * 2);
  });

  return {
    data: buffer.toString("base64"),
    sampleRate: 16_000,
    numChannels: 1,
    samplesPerChannel: samples.length,
  };
}
