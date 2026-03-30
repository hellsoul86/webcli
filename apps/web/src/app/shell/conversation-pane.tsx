import { memo, useState, type ReactNode } from "react";
import type {
  GitWorkingTreeSnapshot,
  ReasoningEffort,
  ThreadSummary,
  TimelineEntry,
  WorkspaceRecord,
} from "@webcli/contracts";
import { translate } from "../../i18n/init";
import { useAppLocale } from "../../i18n/use-i18n";
import {
  type CodeLinkReference,
  type ImagePreviewReference,
  RenderableMarkdown,
} from "../../shared/workbench/renderable-content";
import type { RealtimeSessionState, ThreadView } from "../../store/workbench-store";
import { describeActivityDetails, describeActivitySummary, isMessageEntry, shouldCollapseActivityByDefault } from "./timeline-helpers";
import { RealtimeSessionPanel } from "./realtime-session-panel";
import { ComposerInlineDropdown, type ComposerDropdownOption } from "./workbench-shell-controls";
import { AttachIcon, ExpandIcon, InterruptIcon, SendArrowIcon } from "./workbench-icons";

type EditableApprovalPolicy =
  | "on-request"
  | "on-failure"
  | "untrusted"
  | "never";

type EditableSandboxMode =
  | "danger-full-access"
  | "workspace-write"
  | "read-only";

type QueuedPromptView = {
  id: string;
  text: string;
};

type ComposerPaneProps = {
  composer: string;
  activeTurn: ThreadView["turns"][string] | null;
  selectedWorkspaceForContext: WorkspaceRecord | null;
  activeThreadId: string | null;
  composerModelValue: string;
  composerModelLabel: string;
  composerModelOptions: Array<ComposerDropdownOption<string>>;
  composerReasoningValue: ReasoningEffort;
  composerReasoningLabel: string;
  composerReasoningOptions: Array<ComposerDropdownOption<ReasoningEffort>>;
  composerApprovalPolicy: EditableApprovalPolicy;
  composerApprovalPolicyLabel: string;
  approvalPolicyOptions: Array<ComposerDropdownOption<EditableApprovalPolicy>>;
  composerSandboxMode: EditableSandboxMode;
  composerSandboxModeLabel: string;
  sandboxModeOptions: Array<ComposerDropdownOption<EditableSandboxMode>>;
  currentGitWorkspace: WorkspaceRecord | null;
  gitSummary: {
    files: number;
    additions: number;
    deletions: number;
    title: string;
    detail: string;
    expandable: boolean;
  };
  currentGitBranchName: string | null;
  gitBranchOptions: Array<ComposerDropdownOption<string>>;
  gitBranchSwitchPending: boolean;
  activeGitSnapshot: GitWorkingTreeSnapshot | null;
  activePlan: ThreadView["latestPlan"] | null;
  contextPercent: number | null;
  queuedPrompts: Array<QueuedPromptView>;
  onComposerChange: (value: string) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onModelChange: (value: string) => void;
  onReasoningChange: (value: ReasoningEffort) => void;
  onApprovalPolicyChange: (value: EditableApprovalPolicy) => void;
  onSandboxModeChange: (value: EditableSandboxMode) => void;
  onGitBranchChange: (branch: string) => void;
  onOpenReview: () => void;
  onOpenTerminal: () => void;
  onInterrupt: () => void;
  onSend: () => void;
};

type ConversationPaneProps = {
  gitWorkbenchExpanded: boolean;
  gitReviewPanel: ReactNode;
  selectedWorkspaceForContext: WorkspaceRecord | null;
  activeThreadId: string | null;
  activeThreadView: ThreadView | null;
  activeThreadEntry: ThreadSummary | null;
  activeThreadTitle: string;
  activeThreadArchived: boolean;
  timeline: Array<TimelineEntry>;
  hiddenTimelineEntryCount: number;
  timelineEntryCount: number;
  cwd?: string | null;
  streamingPlainItems: Record<string, true>;
  realtimeSession: RealtimeSessionState | null;
  composerPane: ReactNode;
  conversationBodyRef: React.RefObject<HTMLDivElement | null>;
  onConversationScroll: (event: React.UIEvent<HTMLDivElement>) => void;
  onCodeLinkActivate?: (reference: CodeLinkReference) => void;
  onImageActivate?: (reference: ImagePreviewReference) => void;
  onLoadOlder: () => void;
  onCreateWorkspace: () => void;
  onSuggestionClick: (prompt: string) => void;
};

export function ConversationPane(props: ConversationPaneProps) {
  return (
    <section
      className={
        props.gitWorkbenchExpanded
          ? "conversation-shell conversation-shell--git-expanded"
          : "conversation-shell"
      }
    >
      {props.gitWorkbenchExpanded ? (
        props.gitReviewPanel
      ) : (
        <>
          <div
            className="conversation-body"
            ref={props.conversationBodyRef}
            onScroll={props.onConversationScroll}
          >
            {!props.selectedWorkspaceForContext && !props.activeThreadId ? (
              <EmptyWorkspaceState onCreateWorkspace={props.onCreateWorkspace} />
            ) : props.activeThreadView ? (
              props.timeline.length > 0 ? (
                <ConversationTimeline
                  timeline={props.timeline}
                  hiddenTimelineEntryCount={props.hiddenTimelineEntryCount}
                  timelineEntryCount={props.timelineEntryCount}
                  cwd={props.cwd}
                  streamingPlainItems={props.streamingPlainItems}
                  onCodeLinkActivate={props.onCodeLinkActivate}
                  onImageActivate={props.onImageActivate}
                  onLoadOlder={props.onLoadOlder}
                />
              ) : (
                <EmptyThreadState
                  threadTitle={props.activeThreadTitle}
                  threadStatus={describeThreadStatus(props.activeThreadEntry?.status)}
                  archived={props.activeThreadArchived}
                />
              )
            ) : (
              <ReadyState
                workspace={props.selectedWorkspaceForContext}
                onSuggestionClick={props.onSuggestionClick}
              />
            )}
          </div>

          {props.realtimeSession ? <RealtimeSessionPanel session={props.realtimeSession} /> : null}
          {props.composerPane}
        </>
      )}
    </section>
  );
}

export function ComposerPane(props: ComposerPaneProps) {
  const { t } = useAppLocale();
  const [expanded, setExpanded] = useState(false);

  const isWorking = !!props.activeTurn;
  const statusLabel = isWorking ? t("composer.statusWorking") : t("composer.statusAwaiting");

  return (
    <div className="composer-shell">
      {/* --- Status bar: ● Awaiting input ... context% --- */}
      <div className="composer-status-bar" data-testid="composer-status-bar">
        <span className={`composer-status-bar__dot ${isWorking ? "composer-status-bar__dot--working" : ""}`} />
        <span className="composer-status-bar__label">{statusLabel}</span>
        {props.currentGitWorkspace ? (
          <GitSummaryBar
            summary={props.gitSummary}
            branchValue={props.currentGitBranchName}
            branchOptions={props.gitBranchOptions}
            branchDisabled={
              !props.activeGitSnapshot?.isGitRepository || props.gitBranchSwitchPending
            }
            onOpen={props.onOpenReview}
            onOpenTerminal={props.onOpenTerminal}
            onBranchChange={props.onGitBranchChange}
          />
        ) : null}
        {props.contextPercent !== null ? (
          <span className="composer-status-bar__context" data-testid="composer-context-percent">
            <ContextRing percent={props.contextPercent} />
            <span>{formatContextPercent(props.contextPercent)} context</span>
          </span>
        ) : null}
      </div>

      {props.activePlan && (props.activePlan.explanation || props.activePlan.plan.length > 0) ? (
        <ComposerPlanCard plan={props.activePlan} />
      ) : null}

      {props.queuedPrompts.length > 0 ? (
        <div className="composer-queue" data-testid="composer-queue">
          {props.queuedPrompts.map((queuedPrompt, index) => (
            <div key={queuedPrompt.id} className="composer-queue__item">
              <span className="composer-queue__label">
                {t("composer.queued", { index: index + 1 })}
              </span>
              <span className="composer-queue__text">{queuedPrompt.text}</span>
            </div>
          ))}
        </div>
      ) : null}

      {/* --- Textarea with expand button --- */}
      <div className={`composer-input-shell ${expanded ? "composer-input-shell--expanded" : ""}`}>
        <textarea
          data-testid="composer-input"
          value={props.composer}
          onChange={(event) => props.onComposerChange(event.target.value)}
          onKeyDown={props.onKeyDown}
          placeholder={t("composer.inputPlaceholder")}
        />
        <button
          className="composer-expand-button"
          data-testid="composer-expand-button"
          type="button"
          aria-label={t("composer.expand")}
          onClick={() => setExpanded(!expanded)}
        >
          <ExpandIcon />
        </button>
      </div>

      {/* --- Bottom toolbar: 📎 | ⚙model | Thinking ●○ | Plan ●○ (approval+sandbox in dropdown) | ↵ send --- */}
      <div className="composer-bottom-bar" data-testid="composer-bottom-bar">
        <div className="composer-bottom-bar__left">
          <button
            className="composer-bottom-bar__icon-button"
            data-testid="composer-attach-button"
            type="button"
            aria-label={t("composer.attach")}
          >
            <AttachIcon />
          </button>
          <span className="composer-bottom-bar__separator" />
          <ComposerInlineDropdown
            testId="composer-model-select"
            value={props.composerModelValue}
            label={props.composerModelLabel}
            options={props.composerModelOptions}
            disabled={props.composerModelOptions.length === 0}
            onChange={props.onModelChange}
          />
          <span className="composer-bottom-bar__separator" />
          <label className="composer-toggle" data-testid="composer-reasoning-select">
            <span className="composer-toggle__label">{t("composer.thinking")}</span>
            <button
              type="button"
              role="switch"
              className={`composer-toggle__switch ${isThinkingOn(props.composerReasoningValue) ? "composer-toggle__switch--on" : ""}`}
              aria-checked={isThinkingOn(props.composerReasoningValue)}
              data-value={props.composerReasoningValue}
              onClick={() => {
                const lowestEffort = props.composerReasoningOptions[0]?.value ?? "low";
                const highestEffort = props.composerReasoningOptions[props.composerReasoningOptions.length - 1]?.value ?? "xhigh";
                props.onReasoningChange(isThinkingOn(props.composerReasoningValue) ? lowestEffort : highestEffort);
              }}
            >
              <span className="composer-toggle__thumb" />
            </button>
          </label>
          <span className="composer-bottom-bar__separator" />
          <ComposerInlineDropdown
            testId="composer-approval-policy-select"
            value={props.composerApprovalPolicy}
            label={props.composerApprovalPolicyLabel}
            options={props.approvalPolicyOptions}
            menuTitle={t("composer.approvalMenu")}
            onChange={props.onApprovalPolicyChange}
          />
          <ComposerInlineDropdown
            testId="composer-sandbox-mode-select"
            value={props.composerSandboxMode}
            label={props.composerSandboxModeLabel}
            options={props.sandboxModeOptions}
            menuTitle={t("composer.sandboxMenu")}
            onChange={props.onSandboxModeChange}
          />
        </div>
        <button
          className={
            isWorking
              ? "composer-submit-button composer-submit-button--interrupt"
              : "composer-submit-button"
          }
          data-testid="send-button"
          type="button"
          aria-label={isWorking ? t("composer.interrupt") : t("composer.send")}
          onClick={() => {
            if (isWorking) {
              props.onInterrupt();
              return;
            }
            props.onSend();
          }}
          disabled={
            isWorking
              ? !props.activeThreadId
              : !props.composer.trim() ||
                (!props.selectedWorkspaceForContext && !props.activeThreadId)
          }
        >
          {isWorking ? <InterruptIcon /> : <SendArrowIcon />}
        </button>
      </div>
    </div>
  );
}

function EmptyWorkspaceState(props: { onCreateWorkspace: () => void }) {
  const { t } = useAppLocale();
  return (
    <div className="conversation-empty">
      <p className="conversation-empty__eyebrow">{t("shell.emptyWorkspaceEyebrow")}</p>
      <h2>{t("shell.emptyWorkspaceTitle")}</h2>
      <p>{t("shell.emptyWorkspaceBody")}</p>
      <button className="primary-button" onClick={props.onCreateWorkspace}>
        {t("workspace.modalTitleNew")}
      </button>
    </div>
  );
}

function ReadyState(props: {
  workspace: WorkspaceRecord | null;
  onSuggestionClick: (prompt: string) => void;
}) {
  const { t } = useAppLocale();
  const promptSuggestions = [
    t("prompts.summarizeRisks"),
    t("prompts.reviewStructure"),
    t("prompts.fixHighestRiskBug"),
  ];

  return (
    <div className="conversation-ready">
      <div>
        <p className="conversation-empty__eyebrow">{t("shell.readyEyebrow")}</p>
        <h2>
          {props.workspace
            ? t("shell.readyStartThread", { name: props.workspace.name })
            : t("shell.readySelectProject")}
        </h2>
      </div>
      <div className="suggestion-list">
        {promptSuggestions.map((prompt) => (
          <button
            key={prompt}
            className="suggestion-chip"
            onClick={() => props.onSuggestionClick(prompt)}
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}

function EmptyThreadState(props: {
  threadTitle: string;
  threadStatus: string;
  archived: boolean;
}) {
  const { t } = useAppLocale();
  return (
    <div className="conversation-ready">
      <div>
        <p className="conversation-empty__eyebrow">
          {props.archived ? t("settings.archivedThreads") : props.threadStatus}
        </p>
        <h2>{props.threadTitle}</h2>
      </div>
      <p>{t("shell.emptyThreadBody")}</p>
    </div>
  );
}

function ComposerPlanCard(props: {
  plan: NonNullable<ThreadView["latestPlan"]>;
}) {
  const { t } = useAppLocale();
  const completedCount = props.plan.plan.filter((step) => normalizePlanStepStatus(step.status) === "completed").length;

  return (
    <section className="composer-plan" data-testid="composer-plan">
      <div className="composer-plan__header">
        <div>
          <span className="composer-plan__eyebrow">{t("timeline.planTitle")}</span>
          <strong>
            {t("timeline.planSummary", {
              total: props.plan.plan.length,
              completed: completedCount,
            })}
          </strong>
        </div>
      </div>

      {props.plan.explanation ? (
        <p className="composer-plan__explanation">{props.plan.explanation}</p>
      ) : null}

      {props.plan.plan.length > 0 ? (
        <div className="composer-plan__list">
          {props.plan.plan.map((step, index) => {
            const normalizedStatus = normalizePlanStepStatus(step.status);
            return (
              <div key={`${index}-${step.step}`} className="composer-plan__row">
                <span
                  className={`composer-plan__status composer-plan__status--${normalizedStatus}`}
                  aria-hidden="true"
                />
                <span className="composer-plan__index">{`${index + 1}.`}</span>
                <span className="composer-plan__step">{step.step}</span>
                <span className="composer-plan__state">{formatPlanStepStatus(step.status)}</span>
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

const ConversationTimeline = memo(function ConversationTimeline(props: {
  timeline: Array<TimelineEntry>;
  hiddenTimelineEntryCount: number;
  timelineEntryCount: number;
  cwd?: string | null;
  streamingPlainItems: Record<string, true>;
  onCodeLinkActivate?: (reference: CodeLinkReference) => void;
  onImageActivate?: (reference: ImagePreviewReference) => void;
  onLoadOlder: () => void;
}) {
  useAppLocale();

  return (
    <div className="timeline-stream" data-testid="timeline-list">
      {props.hiddenTimelineEntryCount > 0 ? (
        <div className="timeline-stream__window-banner">
          <span className="timeline-stream__window-summary">
            {translate("timeline.windowSummary", {
              visible: props.timeline.length,
              total: props.timelineEntryCount,
            })}
          </span>
          <button
            className="timeline-stream__window-button"
            type="button"
            onClick={props.onLoadOlder}
          >
            {translate("timeline.loadOlder")}
          </button>
        </div>
      ) : null}
      {props.timeline.map((entry) => (
        <ConversationEntry
          key={entry.id}
          entry={entry}
          cwd={props.cwd}
          streamingPlainText={Boolean(props.streamingPlainItems[entry.id])}
          onCodeLinkActivate={props.onCodeLinkActivate}
          onImageActivate={props.onImageActivate}
        />
      ))}
    </div>
  );
});

const ConversationEntry = memo(function ConversationEntry(props: {
  entry: TimelineEntry;
  cwd?: string | null;
  streamingPlainText?: boolean;
  onCodeLinkActivate?: (reference: CodeLinkReference) => void;
  onImageActivate?: (reference: ImagePreviewReference) => void;
}) {
  const { entry, cwd, streamingPlainText, onCodeLinkActivate, onImageActivate } = props;
  return isMessageEntry(entry.kind) ? (
    <MessageEntry
      entry={entry}
      cwd={cwd}
      streamingPlainText={Boolean(streamingPlainText && entry.kind === "agentMessage")}
      onCodeLinkActivate={onCodeLinkActivate}
      onImageActivate={onImageActivate}
    />
  ) : (
    <ActivityEntry
      entry={entry}
      cwd={cwd}
      streamingPlainText={Boolean(streamingPlainText && entry.kind === "reasoning")}
      onCodeLinkActivate={onCodeLinkActivate}
      onImageActivate={onImageActivate}
    />
  );
});

const MessageEntry = memo(function MessageEntry(props: {
  entry: TimelineEntry;
  cwd?: string | null;
  streamingPlainText?: boolean;
  onCodeLinkActivate?: (reference: CodeLinkReference) => void;
  onImageActivate?: (reference: ImagePreviewReference) => void;
}) {
  useAppLocale();
  const { entry, cwd, streamingPlainText, onCodeLinkActivate, onImageActivate } = props;
  const placeholder = entry.kind === "agentMessage" ? translate("common.loading") : "...";

  return (
    <article
      className={`stream-entry stream-entry--message ${
        entry.kind === "userMessage" ? "stream-entry--user" : "stream-entry--assistant"
      }`}
      data-testid={`timeline-item-${entry.id}`}
    >
      {entry.body.trim() ? (
        <RenderableMarkdown
          text={entry.body}
          cwd={cwd}
          renderMode={streamingPlainText ? "plain" : "auto"}
          onCodeLinkActivate={onCodeLinkActivate}
          onImageActivate={onImageActivate}
        />
      ) : (
        <div className="stream-entry__placeholder">{placeholder}</div>
      )}
    </article>
  );
});

const ActivityEntry = memo(function ActivityEntry(props: {
  entry: TimelineEntry;
  cwd?: string | null;
  streamingPlainText?: boolean;
  onCodeLinkActivate?: (reference: CodeLinkReference) => void;
  onImageActivate?: (reference: ImagePreviewReference) => void;
}) {
  useAppLocale();
  const { entry, cwd, streamingPlainText, onCodeLinkActivate, onImageActivate } = props;
  const summary = describeActivitySummary(entry);
  const details = describeActivityDetails(entry);
  const collapsible = shouldCollapseActivityByDefault(entry.kind) && Boolean(details?.trim());
  const [expanded, setExpanded] = useState(() => !collapsible);

  return (
    <article
      className={`stream-entry stream-entry--activity stream-entry--activity-${entry.kind}`}
      data-testid={`timeline-item-${entry.id}`}
    >
      {collapsible ? (
        <button
          className={expanded ? "stream-activity__toggle stream-activity__toggle--expanded" : "stream-activity__toggle"}
          type="button"
          onClick={() => setExpanded((current) => !current)}
        >
          <span className="stream-activity__chevron" aria-hidden="true">
            ▸
          </span>
          <span className="stream-activity__summary">
            {renderInlineFormattedText(summary, `${entry.id}-summary`)}
          </span>
        </button>
      ) : (
        <div className="stream-activity__summary">
          {renderInlineFormattedText(summary, `${entry.id}-summary`)}
        </div>
      )}
      {details && (!collapsible || expanded) ? (
        <div className="stream-activity__details">
          <RenderableMarkdown
            text={details}
            cwd={cwd}
            compact
            renderMode={streamingPlainText ? "plain" : "auto"}
            onCodeLinkActivate={onCodeLinkActivate}
            onImageActivate={onImageActivate}
          />
        </div>
      ) : null}
    </article>
  );
});

function renderInlineFormattedText(text: string, keyPrefix: string): ReactNode {
  if (!text) {
    return null;
  }

  return text.split(/(`[^`\n]+`|\[[^\]]+\]\([^)]+\))/g).map((part, index) => {
    if (!part) {
      return null;
    }

    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={`${keyPrefix}-code-${index}`}>{part.slice(1, -1)}</code>;
    }

    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      return (
        <a
          key={`${keyPrefix}-link-${index}`}
          href={linkMatch[2]}
          target="_blank"
          rel="noreferrer"
        >
          {linkMatch[1]}
        </a>
      );
    }

    return <span key={`${keyPrefix}-text-${index}`}>{part}</span>;
  });
}

function GitSummaryBar(props: {
  summary: ComposerPaneProps["gitSummary"];
  branchValue: string | null;
  branchOptions: Array<ComposerDropdownOption<string>>;
  branchDisabled: boolean;
  onOpen: () => void;
  onOpenTerminal: () => void;
  onBranchChange: (branch: string) => void;
}) {
  const { t } = useAppLocale();
  return (
    <div className="composer-gitbar">
      {props.branchValue ? (
        <ComposerInlineDropdown
          testId="composer-git-branch-select"
          value={props.branchValue}
          label={props.branchValue}
          options={props.branchOptions}
          menuTitle={t("composer.switchBranchMenu")}
          disabled={props.branchDisabled || props.branchOptions.length === 0}
          onChange={props.onBranchChange}
        />
      ) : null}
      <div
        className={
          props.summary.expandable
            ? "composer-gitbar__summary"
            : "composer-gitbar__summary composer-gitbar__summary--disabled"
        }
        data-testid="git-summary-bar"
      >
        <span>{t("composer.gitFilesCount", { count: props.summary.files })}</span>
        <span className="window-stat window-stat--positive">{`+${props.summary.additions}`}</span>
        <span className="window-stat window-stat--negative">{`-${props.summary.deletions}`}</span>
      </div>
      <button
        type="button"
        className="ghost-button composer-gitbar__review"
        data-testid="git-workbench-open-button"
        onClick={props.onOpen}
        disabled={!props.summary.expandable}
      >
        {t("composer.review")}
      </button>
      <button
        type="button"
        className="ghost-button composer-gitbar__review"
        data-testid="command-terminal-button"
        onClick={props.onOpenTerminal}
      >
        {t("command.openTerminal")}
      </button>
    </div>
  );
}

function describeThreadStatus(status: ThreadSummary["status"] | string | null | undefined): string {
  if (!status) {
    return translate("common.unknownState");
  }

  if (typeof status === "string") {
    return status === "active" ? translate("common.active") : status;
  }

  if (status.type === "active") {
    return translate("common.active");
  }

  return status.type ?? translate("common.unknownState");
}

function normalizePlanStepStatus(status: string | null | undefined): "completed" | "active" | "pending" {
  if (status === "completed" || status === "done") {
    return "completed";
  }

  if (status === "in_progress" || status === "inProgress" || status === "running" || status === "active") {
    return "active";
  }

  return "pending";
}

function formatPlanStepStatus(status: string | null | undefined): string {
  if (status === "completed" || status === "done") {
    return translate("timeline.planCompleted");
  }

  if (status === "in_progress" || status === "inProgress" || status === "running" || status === "active") {
    return translate("timeline.planActive");
  }

  if (status === "pending" || status === "not_started" || status === "todo") {
    return translate("timeline.planPending");
  }

  return status || translate("timeline.planPending");
}

function isThinkingOn(effort: ReasoningEffort): boolean {
  return effort !== "none" && effort !== "low";
}

function ContextRing({ percent }: { percent: number }) {
  const r = 7;
  const circ = 2 * Math.PI * r;
  const filled = Math.min(1, Math.max(0, percent / 100)) * circ;
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" className="composer-context-ring">
      <circle cx="9" cy="9" r={r} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="2" />
      <circle
        cx="9" cy="9" r={r} fill="none"
        stroke={percent > 80 ? "#f06d65" : percent > 50 ? "#facc15" : "rgba(220,225,235,0.5)"}
        strokeWidth="2"
        strokeDasharray={`${filled} ${circ - filled}`}
        strokeDashoffset={circ / 4}
        strokeLinecap="round"
      />
    </svg>
  );
}

function formatContextPercent(percent: number): string {
  if (percent < 1) return `${percent.toFixed(1)}%`;
  return `${Math.round(percent)}%`;
}
