import { useState } from "react";
import type { ThreadSummary, WorkspaceRecord } from "@webcli/contracts";
import { useAppLocale } from "../../i18n/use-i18n";
import { ArchiveIcon, ComposeIcon, FolderIcon, FolderOpenIcon, FolderPlusIcon, GearIcon, ListIcon, GroupIcon, MoreIcon, SearchIcon } from "./workbench-icons";

export type SidebarThreadItem = {
  thread: ThreadSummary;
  title: string;
  relativeTime: string;
  absoluteTime: string;
  active: boolean;
  running: boolean;
  showCompletionMark: boolean;
  menuOpen: boolean;
};

export type SidebarWorkspaceGroup = {
  workspace: WorkspaceRecord;
  subtitle?: string | null;
  active: boolean;
  expanded: boolean;
  threads: Array<SidebarThreadItem>;
};

type WorkbenchSidebarProps = {
  className?: string;
  visibleWorkspaceCount: number;
  workspaceGroups: Array<SidebarWorkspaceGroup>;
  activeWorkspaceId: string | "all";
  emptyProjects: boolean;
  emptyThreads: boolean;
  archivedCount?: number;
  onSelectAll: () => void;
  onCreateWorkspace: () => void;
  onSelectWorkspace: (workspaceId: string) => void;
  onComposeWorkspace: (workspaceId: string) => void;
  onEditWorkspace: (workspace: WorkspaceRecord) => void;
  onResumeThread: (threadId: string, workspaceId: string) => void;
  onToggleThreadMenu: (threadId: string) => void;
  onRenameThread: (thread: ThreadSummary) => void;
  onForkThread: (thread: ThreadSummary) => void;
  onArchiveThread: (thread: ThreadSummary) => void;
  onOpenArchived?: () => void;
};

export function WorkbenchSidebar(props: WorkbenchSidebarProps) {
  const { t } = useAppLocale();
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"grouped" | "list">("grouped");

  const filteredGroups = searchQuery.trim()
    ? props.workspaceGroups.map((group) => ({
        ...group,
        expanded: true,
        threads: group.threads.filter((th) =>
          th.title.toLowerCase().includes(searchQuery.toLowerCase()),
        ),
      })).filter((group) =>
        group.threads.length > 0 ||
        group.workspace.name.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : props.workspaceGroups;

  const flatThreads = viewMode === "list"
    ? filteredGroups.flatMap((group) => group.threads.map((th) => ({ ...th, workspaceId: group.workspace.id })))
    : [];

  return (
    <aside className={`sidebar-shell${props.className ? ` ${props.className}` : ""}`}>
      <div className="sidebar-brand">
        <div className="sidebar-brand__mark">C</div>
        <div className="sidebar-brand__body">
          <span className="sidebar-brand__eyebrow">Remote Codex</span>
          <strong>webcli</strong>
        </div>
      </div>

      <section className="sidebar-section sidebar-section--main">
        {/* --- Header: SESSIONS + refresh + new --- */}
        <div className="sidebar-tree-toolbar">
          <button
            className={
              props.activeWorkspaceId === "all"
                ? "workspace-tree__row sidebar-tree-toolbar__label sidebar-toggle--active"
                : "workspace-tree__row sidebar-tree-toolbar__label"
            }
            data-testid="workspace-all-button"
            onClick={props.onSelectAll}
          >
            <span>{t("sidebar.projectsCount", { count: props.visibleWorkspaceCount })}</span>
          </button>
          <button
            className="sidebar-icon-button"
            data-testid="workspace-create-button"
            aria-label={t("common.newProject")}
            onClick={props.onCreateWorkspace}
          >
            <FolderPlusIcon />
          </button>
        </div>

        {/* --- Search box --- */}
        <div className="sidebar-search" data-testid="sidebar-search">
          <SearchIcon />
          <input
            type="text"
            className="sidebar-search__input"
            data-testid="sidebar-search-input"
            placeholder={t("sidebar.searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {/* --- View toggle: list / grouped --- */}
          <div className="sidebar-view-toggle" data-testid="sidebar-view-toggle">
            <button
              className={`sidebar-view-toggle__button ${viewMode === "list" ? "sidebar-view-toggle__button--active" : ""}`}
              type="button"
              aria-label={t("sidebar.listView")}
              onClick={() => setViewMode("list")}
            >
              <ListIcon />
            </button>
            <button
              className={`sidebar-view-toggle__button ${viewMode === "grouped" ? "sidebar-view-toggle__button--active" : ""}`}
              type="button"
              aria-label={t("sidebar.groupedView")}
              onClick={() => setViewMode("grouped")}
            >
              <GroupIcon />
            </button>
          </div>
        </div>

        {/* --- Thread/workspace list --- */}
        <div className="workspace-tree">
          {viewMode === "grouped" ? (
            <>
              {filteredGroups.map((group) => (
                <div className="workspace-group" key={group.workspace.id}>
                  <WorkspaceListRow
                    workspace={group.workspace}
                    subtitle={group.subtitle}
                    active={group.active}
                    expanded={group.expanded}
                    onSelect={() => props.onSelectWorkspace(group.workspace.id)}
                    onCompose={() => props.onComposeWorkspace(group.workspace.id)}
                    onEdit={() => props.onEditWorkspace(group.workspace)}
                  />
                  {group.expanded && group.threads.length > 0 ? (
                    <div className="thread-list thread-list--nested">
                      {group.threads.map((thread) => (
                        <ThreadRow
                          key={thread.thread.id}
                          thread={thread}
                          nested
                          onClick={() => props.onResumeThread(thread.thread.id, group.workspace.id)}
                          onToggleMenu={() => props.onToggleThreadMenu(thread.thread.id)}
                          onRename={() => props.onRenameThread(thread.thread)}
                          onFork={() => props.onForkThread(thread.thread)}
                          onArchive={() => props.onArchiveThread(thread.thread)}
                        />
                      ))}
                    </div>
                  ) : null}
                  {group.expanded && group.threads.length === 0 ? (
                    <div className="sidebar-empty-state sidebar-empty-state--nested">
                      {t("sidebar.emptyThreadsNested")}
                    </div>
                  ) : null}
                </div>
              ))}
            </>
          ) : (
            <div className="thread-list">
              {flatThreads.map((thread) => (
                <ThreadRow
                  key={thread.thread.id}
                  thread={thread}
                  onClick={() => props.onResumeThread(thread.thread.id, thread.workspaceId)}
                  onToggleMenu={() => props.onToggleThreadMenu(thread.thread.id)}
                  onRename={() => props.onRenameThread(thread.thread)}
                  onFork={() => props.onForkThread(thread.thread)}
                  onArchive={() => props.onArchiveThread(thread.thread)}
                />
              ))}
            </div>
          )}
          {props.emptyThreads ? (
            <div className="sidebar-empty-state">{t("sidebar.emptyThreads")}</div>
          ) : null}
          {props.emptyProjects ? (
            <div className="sidebar-empty-state">{t("sidebar.emptyProjects")}</div>
          ) : null}
        </div>
      </section>

      {/* --- Archived section at bottom --- */}
      {props.onOpenArchived ? (
        <div className="sidebar-archived" data-testid="sidebar-archived">
          <button
            className="sidebar-archived__button"
            type="button"
            onClick={props.onOpenArchived}
          >
            <ArchiveIcon />
            <span>{t("sidebar.archived")}</span>
            <span className="sidebar-archived__count">{props.archivedCount ?? 0}</span>
          </button>
        </div>
      ) : null}
    </aside>
  );
}

function WorkspaceListRow(props: {
  workspace: WorkspaceRecord;
  subtitle?: string | null;
  active: boolean;
  expanded: boolean;
  onSelect: () => void;
  onCompose?: () => void;
  onEdit?: () => void;
}) {
  const { t } = useAppLocale();
  return (
    <div className="workspace-row" data-active={props.active ? "true" : "false"}>
      <button
        className="workspace-row__main"
        data-testid={`workspace-row-${props.workspace.id}`}
        onClick={props.onSelect}
        title={props.workspace.absPath}
      >
        <div className="workspace-row__content">
          <div className="workspace-row__title">
            {props.expanded ? <FolderOpenIcon /> : <FolderIcon />}
            <strong>{props.workspace.name}</strong>
          </div>
          {props.subtitle ? <span>{props.subtitle}</span> : null}
        </div>
      </button>
      <div className="workspace-row__actions">
        {props.onEdit ? (
          <button
            className="workspace-row__icon-button"
            onClick={props.onEdit}
            aria-label={t("sidebar.manageProject")}
          >
            <GearIcon />
          </button>
        ) : null}
        {props.onCompose ? (
          <button
            className="workspace-row__icon-button"
            data-testid={props.active ? "thread-open-button" : undefined}
            onClick={props.onCompose}
            aria-label={t("sidebar.composeThread")}
          >
            <ComposeIcon />
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ThreadRow(props: {
  thread: SidebarThreadItem;
  nested?: boolean;
  onClick: () => void;
  onToggleMenu: () => void;
  onRename: () => void;
  onFork: () => void;
  onArchive: () => void;
}) {
  const { t } = useAppLocale();
  return (
    <div
      className={[
        "thread-row",
        props.nested ? "thread-row--nested" : "",
        props.thread.active ? "thread-row--active" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <button
        className="thread-row__main"
        data-testid={`thread-row-${props.thread.thread.id}`}
        onClick={props.onClick}
      >
        <div className="thread-row__title">
          {props.thread.running ? (
            <span
              className="thread-row__status-indicator thread-row__status-indicator--running"
              title={t("sidebar.threadRunning")}
            />
          ) : props.thread.showCompletionMark ? (
            <span
              className="thread-row__status-indicator thread-row__status-indicator--completed"
              title={t("sidebar.threadCompletedOutput")}
            />
          ) : null}
          <strong>{props.thread.title}</strong>
        </div>
        <span className="thread-row__time" title={props.thread.absoluteTime}>
          {props.thread.relativeTime}
        </span>
      </button>
      <button
        className="thread-row__menu-trigger"
        data-testid={`thread-menu-${props.thread.thread.id}`}
        onClick={(event) => {
          event.stopPropagation();
          props.onToggleMenu();
        }}
      >
        <MoreIcon />
      </button>

      {props.thread.menuOpen ? (
        <div className="thread-row__menu" onClick={(event) => event.stopPropagation()}>
          <button onClick={props.onRename}>{t("sidebar.renameThread")}</button>
          <button onClick={props.onFork}>{t("sidebar.forkThread")}</button>
          <button onClick={props.onArchive}>
            {props.thread.thread.archived ? t("sidebar.restoreThread") : t("sidebar.archiveThread")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
