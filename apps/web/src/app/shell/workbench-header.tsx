import type {
  AccountUsageWindow,
  ConversationSummarySnapshot,
  ThreadSummary,
} from "@webcli/contracts";
import { useAppLocale } from "../../i18n/use-i18n";
import { ComposerInlineDropdown, ComposerSpeedSwitch, type ComposerDropdownOption, type ComposerSpeedMode } from "./workbench-shell-controls";
import { EditIcon, GearIcon, GlobeIcon } from "./workbench-icons";

type WorkbenchHeaderProps = {
  headerWorkspaceLabel: string;
  threadTitle: string;
  activeThreadEntry: ThreadSummary | null;
  conversationSummary: ConversationSummarySnapshot | null;
  threadTitleEditing: boolean;
  threadTitleDraft: string;
  toolbarUsageWindows: Array<AccountUsageWindow>;
  composerSpeedMode: ComposerSpeedMode;
  locale: "zh-CN" | "en-US";
  toolbarLocaleOptions: Array<ComposerDropdownOption<"zh-CN" | "en-US">>;
  onThreadTitleDraftChange: (value: string) => void;
  onCommitThreadTitle: () => void;
  onCancelThreadTitle: () => void;
  onStartThreadTitleEdit: () => void;
  onToggleSpeed: () => void;
  onLocaleChange: (locale: "zh-CN" | "en-US") => void;
  onOpenSettings: () => void;
};

export function WorkbenchHeader(props: WorkbenchHeaderProps) {
  const { t } = useAppLocale();

  return (
    <header className="window-toolbar">
      <div className="window-toolbar__title">
        <div className="toolbar-breadcrumb toolbar-breadcrumb--full">
          <span className="toolbar-breadcrumb__workspace">{props.headerWorkspaceLabel}</span>
          <span className="toolbar-breadcrumb__separator">{">"}</span>
          {props.threadTitleEditing && props.activeThreadEntry ? (
            <input
              className="toolbar-title-input"
              data-testid="thread-title-input"
              autoFocus
              value={props.threadTitleDraft}
              onChange={(event) => props.onThreadTitleDraftChange(event.target.value)}
              onBlur={props.onCommitThreadTitle}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  props.onCommitThreadTitle();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  props.onCancelThreadTitle();
                }
              }}
            />
          ) : (
            <div className="toolbar-breadcrumb__current">
              <h1 className="toolbar-title" data-testid="thread-title-display">
                {props.threadTitle}
              </h1>
              {props.activeThreadEntry ? (
                <button
                  className="toolbar-title-edit"
                  data-testid="thread-title-edit-button"
                  aria-label={t("toolbar.editThreadTitle")}
                  onClick={props.onStartThreadTitleEdit}
                >
                  <EditIcon />
                </button>
              ) : null}
            </div>
          )}
        </div>
        {props.conversationSummary ? (
          <p
            className="window-toolbar__subtitle"
            data-testid="thread-summary-display"
            title={buildConversationSummaryTitle(props.conversationSummary)}
          >
            {buildConversationSummaryLabel(props.conversationSummary)}
          </p>
        ) : null}
      </div>

      <div className="window-toolbar__actions">
        {props.toolbarUsageWindows.map((window) => (
          <span
            key={window.label}
            className="window-toolbar__usage"
            title={buildUsageWindowTitle(window)}
          >
            <span className="window-toolbar__usage-label">{window.label}</span>
            <span className="window-toolbar__usage-value">
              {formatUsageRemaining(window.remainingPercent)}
            </span>
          </span>
        ))}
        <ComposerSpeedSwitch
          className="window-toolbar__speed"
          mode={props.composerSpeedMode}
          disabled={false}
          onToggle={props.onToggleSpeed}
        />
        <ComposerInlineDropdown
          className="window-toolbar__locale-select"
          testId="locale-toggle-button"
          ariaLabel={t("toolbar.toggleLanguage")}
          icon={<GlobeIcon />}
          iconOnly
          menuPlacement="below"
          value={props.locale}
          label={t("settings.language")}
          options={props.toolbarLocaleOptions}
          menuTitle={t("settings.language")}
          onChange={props.onLocaleChange}
        />
        <button
          type="button"
          className="toolbar-pill-button window-toolbar__icon-button"
          data-testid="settings-button"
          aria-label={t("common.settings")}
          title={t("common.settings")}
          onClick={props.onOpenSettings}
        >
          <GearIcon />
        </button>
      </div>
    </header>
  );
}

function buildConversationSummaryLabel(summary: ConversationSummarySnapshot): string {
  const preview = summary.preview.trim();
  const branch = summary.gitInfo?.branch?.trim() || "";
  const parts = [preview || summary.cwd];
  if (branch) {
    parts.push(branch);
  }
  return parts.join(" · ");
}

function buildConversationSummaryTitle(summary: ConversationSummarySnapshot): string {
  const details = [summary.path, summary.cwd];
  if (summary.gitInfo?.originUrl) {
    details.push(summary.gitInfo.originUrl);
  }
  return details.filter(Boolean).join("\n");
}

function formatUsageRemaining(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "--";
  }

  return `${Math.round(Math.max(0, Math.min(100, value)))}%`;
}

function buildUsageWindowTitle(window: AccountUsageWindow): string {
  const parts = [`${window.label} ${formatUsageRemaining(window.remainingPercent)}`];
  if (window.resetsAt) {
    parts.push(formatAbsoluteDateTime(window.resetsAt));
  }
  return parts.join(" · ");
}

function formatAbsoluteDateTime(timestamp: number): string {
  const normalizedTimestamp = normalizeTimestamp(timestamp);
  if (!Number.isFinite(normalizedTimestamp) || normalizedTimestamp <= 0) {
    return "";
  }

  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(normalizedTimestamp);
}

function normalizeTimestamp(timestamp: number): number {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return 0;
  }

  return timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
}
