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
import { InterruptIcon, SendArrowIcon } from "./workbench-icons";

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
  queuedPrompts: Array<QueuedPromptView>;
  onComposerChange: (value: string) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onModelChange: (value: string) => void;
  onReasoningChange: (value: ReasoningEffort) => void;
  onApprovalPolicyChange: (value: EditableApprovalPolicy) => void;
  onSandboxModeChange: (value: EditableSandboxMode) => void;
  onGitBranchChange: (branch: string) => void;
  onOpenReview: () => void;
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

  return (
    <div className="composer-shell">
      <div className="composer-shell__toolbar">
        <div className="composer-toolbar__selectors">
          <ComposerInlineDropdown
            testId="composer-model-select"
            value={props.composerModelValue}
            label={props.composerModelLabel}
            options={props.composerModelOptions}
            disabled={props.composerModelOptions.length === 0}
            onChange={props.onModelChange}
          />
          <ComposerInlineDropdown
            testId="composer-reasoning-select"
            value={props.composerReasoningValue}
            label={props.composerReasoningLabel}
            options={props.composerReasoningOptions}
            menuTitle={t("composer.reasoningMenu")}
            onChange={props.onReasoningChange}
          />
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
        {props.currentGitWorkspace ? (
          <GitSummaryBar
            summary={props.gitSummary}
            branchValue={props.currentGitBranchName}
            branchOptions={props.gitBranchOptions}
            branchDisabled={
              !props.activeGitSnapshot?.isGitRepository || props.gitBranchSwitchPending
            }
            onOpen={props.onOpenReview}
            onBranchChange={props.onGitBranchChange}
          />
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

      <div className="composer-input-shell">
        <textarea
          data-testid="composer-input"
          value={props.composer}
          onChange={(event) => props.onComposerChange(event.target.value)}
          onKeyDown={props.onKeyDown}
          placeholder={t("composer.placeholder")}
        />
        <button
          className={
            props.activeTurn
              ? "composer-inline-button composer-inline-button--interrupt"
              : "composer-inline-button composer-inline-button--send"
          }
          data-testid="send-button"
          aria-label={props.activeTurn ? t("composer.interrupt") : t("composer.send")}
          onClick={() => {
            if (props.activeTurn) {
              props.onInterrupt();
              return;
            }
            props.onSend();
          }}
          disabled={
            props.activeTurn
              ? !props.activeThreadId
              : !props.composer.trim() ||
                (!props.selectedWorkspaceForContext && !props.activeThreadId)
          }
        >
          {props.activeTurn ? <InterruptIcon /> : <SendArrowIcon />}
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
