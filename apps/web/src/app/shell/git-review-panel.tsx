import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type {
  GitFileReviewDetail,
  GitRemoteDiffSnapshot,
  GitWorkingTreeFile,
  GitWorkingTreeSnapshot,
  WorkspaceRecord,
} from "@webcli/contracts";
import { localizeErrorWithFallback } from "../../i18n/errors";
import { useAppLocale } from "../../i18n/use-i18n";
import { RenderableCodeBlock } from "../../shared/workbench/renderable-content";
import { summarizeGitSnapshot } from "./inspector-helpers";
import {
  buildGitReviewGroups,
  collectAutoExpandedDirectoryKeys,
  findGitReviewFile,
  resolvePreferredGitReviewFile,
  type GitReviewGroup,
  type GitReviewGroupId,
  type GitReviewTreeNode,
} from "./git-review-helpers";

const LazyGitDiffViewer = lazy(() =>
  import("./git-diff-viewer").then((module) => ({
    default: module.GitDiffViewer,
  })),
);

type GitReviewPanelProps = {
  workspace: WorkspaceRecord | null;
  snapshot: GitWorkingTreeSnapshot | null;
  selectedPath: string | null;
  treeFilter: string;
  treeWidth: number;
  treeBounds: { min: number; max: number };
  treeResizing: boolean;
  onClose: () => void;
  onSelectFile: (path: string | null) => void;
  onTreeFilterChange: (value: string) => void;
  onRefresh: () => void;
  onReadFileDetail: (path: string) => Promise<GitFileReviewDetail>;
  onReadRemoteDiff: () => Promise<GitRemoteDiffSnapshot>;
  onResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onResizeKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  isMobile: boolean;
};

export function GitReviewPanel(props: GitReviewPanelProps) {
  const { t } = useAppLocale();
  const {
    onClose,
    onReadFileDetail,
    onReadRemoteDiff,
    onRefresh,
    onResizeKeyDown,
    onResizeStart,
    onSelectFile,
    onTreeFilterChange,
    selectedPath,
    snapshot,
    treeBounds,
    treeFilter,
    treeResizing,
    treeWidth,
    workspace,
    isMobile,
  } = props;
  const [mobileView, setMobileView] = useState<"tree" | "diff">("tree");
  const summary = useMemo(() => summarizeGitSnapshot(snapshot), [snapshot]);
  const groups = useMemo(
    () => buildGitReviewGroups(snapshot?.files ?? [], treeFilter),
    [snapshot?.files, treeFilter],
  );
  const visibleSelectedPath = useMemo(
    () => resolvePreferredGitReviewFile(groups, selectedPath),
    [groups, selectedPath],
  );
  const selectedFile = useMemo(
    () => findGitReviewFile(groups, visibleSelectedPath),
    [groups, visibleSelectedPath],
  );
  const [expandedGroupIds, setExpandedGroupIds] = useState<Array<GitReviewGroupId>>([]);
  const [expandedDirectoryKeys, setExpandedDirectoryKeys] = useState<Array<string>>([]);
  const [detailByPath, setDetailByPath] = useState<Record<string, GitFileReviewDetail>>({});
  const [detailLoadingPath, setDetailLoadingPath] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [diffMode, setDiffMode] = useState<"working-tree" | "remote">("working-tree");
  const [remoteDiff, setRemoteDiff] = useState<GitRemoteDiffSnapshot | null>(null);
  const [remoteDiffLoading, setRemoteDiffLoading] = useState(false);
  const [remoteDiffError, setRemoteDiffError] = useState<string | null>(null);
  const snapshotIdentity = `${snapshot?.workspaceId ?? "none"}:${snapshot?.generatedAt ?? 0}`;
  const autoExpandedDirectoryKeys = useMemo(
    () => collectAutoExpandedDirectoryKeys(groups, visibleSelectedPath, treeFilter),
    [groups, treeFilter, visibleSelectedPath],
  );

  const handleSelectFile = useCallback(
    (path: string | null) => {
      setDiffMode("working-tree");
      onSelectFile(path);
      if (isMobile && path) {
        setMobileView("diff");
      }
    },
    [isMobile, onSelectFile],
  );

  useEffect(() => {
    if (visibleSelectedPath !== selectedPath) {
      handleSelectFile(visibleSelectedPath);
    }
  }, [handleSelectFile, selectedPath, visibleSelectedPath]);

  useEffect(() => {
    const availableIds = groups.map((group) => group.id);
    setExpandedGroupIds((current) => {
      const next = current.filter((id) => availableIds.includes(id));
      for (const id of availableIds) {
        if (!next.includes(id)) {
          next.push(id);
        }
      }
      return arraysEqual(current, next) ? current : next;
    });
  }, [groups]);

  useEffect(() => {
    const availableKeys = new Set(collectDirectoryKeys(groups));
    setExpandedDirectoryKeys((current) => {
      const next = current.filter((key) => availableKeys.has(key));
      for (const key of autoExpandedDirectoryKeys) {
        if (!next.includes(key)) {
          next.push(key);
        }
      }
      return arraysEqual(current, next) ? current : next;
    });
  }, [autoExpandedDirectoryKeys, groups]);

  useEffect(() => {
    setDetailByPath({});
    setDetailLoadingPath(null);
    setDetailError(null);
    setDiffMode("working-tree");
    setRemoteDiff(null);
    setRemoteDiffLoading(false);
    setRemoteDiffError(null);
  }, [snapshotIdentity]);

  useEffect(() => {
    if (!snapshot || !snapshot.isGitRepository || diffMode !== "remote" || remoteDiff) {
      return;
    }

    let cancelled = false;
    setRemoteDiffLoading(true);
    setRemoteDiffError(null);

    void onReadRemoteDiff()
      .then((nextDiff) => {
        if (!cancelled) {
          setRemoteDiff(nextDiff);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setRemoteDiffError(localizeErrorWithFallback(error, "errors.requestFailed"));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setRemoteDiffLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [diffMode, onReadRemoteDiff, remoteDiff, snapshot]);

  useEffect(() => {
    if (!snapshot || !visibleSelectedPath || detailByPath[visibleSelectedPath]) {
      return;
    }

    let cancelled = false;
    setDetailLoadingPath(visibleSelectedPath);
    setDetailError(null);

    void onReadFileDetail(visibleSelectedPath)
      .then((detail) => {
        if (cancelled) {
          return;
        }
        setDetailByPath((current) => ({
          ...current,
          [visibleSelectedPath]: detail,
        }));
      })
      .catch((error) => {
        if (!cancelled) {
          setDetailError(localizeErrorWithFallback(error, "errors.requestFailed"));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setDetailLoadingPath((current) => (current === visibleSelectedPath ? null : current));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [detailByPath, onReadFileDetail, snapshot, visibleSelectedPath]);

  const detail = visibleSelectedPath ? detailByPath[visibleSelectedPath] ?? null : null;

  const remoteDiffLabel = useMemo(
    () => (remoteDiff ? t("git.remoteDiffSha", { sha: remoteDiff.sha }) : t("git.remoteDiffReady")),
    [remoteDiff, t],
  );

  if (!workspace) {
    return (
      <div className="git-review-panel git-review-panel--empty" data-testid="git-workbench">
        <strong>{t("git.noCurrentProjectTitle")}</strong>
        <p>{t("git.noCurrentProjectDetail")}</p>
      </div>
    );
  }

  return (
    <div
      className="git-review-panel"
      data-testid="git-workbench"
      style={{ "--git-tree-width": `${treeWidth}px` } as CSSProperties}
    >
      <div className="git-review-panel__header">
        <div className="git-review-panel__header-main">
          <p className="git-review-panel__eyebrow">{t("git.reviewTitle")}</p>
          <strong>{workspace.name}</strong>
          <div className="git-review-panel__meta">
            <span
              className="git-review-panel__meta-item git-review-panel__meta-item--branch"
              title={snapshot?.branch ?? ""}
            >
              {snapshot?.branch ?? t("git.noBranch")}
            </span>
            <span>{summary.detail}</span>
          </div>
        </div>
        <div className="git-review-panel__header-actions">
          {isMobile ? (
            <>
              <div className="git-review-panel__mobile-tabs" data-testid="git-mobile-tabs">
                <button
                  type="button"
                  className={`ghost-button${mobileView === "tree" ? " ghost-button--active" : ""}`}
                  onClick={() => setMobileView("tree")}
                >
                  {t("git.mobileFilesTab")}
                </button>
                <button
                  type="button"
                  className={`ghost-button${mobileView === "diff" ? " ghost-button--active" : ""}`}
                  onClick={() => setMobileView("diff")}
                >
                  {t("git.mobileDiffTab")}
                </button>
              </div>
              <button type="button" className="ghost-button" onClick={onClose}>
                {t("git.backToSession")}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="ghost-button"
                onClick={() => {
                  setRemoteDiff(null);
                  setRemoteDiffError(null);
                  void onRefresh();
                }}
              >
                {t("git.refresh")}
              </button>
              <button
                type="button"
                className="ghost-button"
                data-testid="git-remote-diff-button"
                aria-pressed={diffMode === "remote"}
                disabled={!snapshot?.isGitRepository}
                onClick={() => setDiffMode((current) => (current === "remote" ? "working-tree" : "remote"))}
              >
                {t("git.remoteDiff")}
              </button>
              <button type="button" className="ghost-button" onClick={onClose}>
                {t("git.backToSession")}
              </button>
            </>
          )}
        </div>
      </div>

      <div className={`git-review-panel__body${isMobile ? " git-review-panel__body--mobile" : ""}`}>
        {(!isMobile || mobileView === "tree") && <aside className="git-review-panel__tree">
          <div className="git-review-panel__tree-header">
            <div>
              <p className="git-review-panel__eyebrow">{t("git.treeTitle")}</p>
              <strong>{t("git.treeLabel")}</strong>
            </div>
            <span className="git-review-panel__tree-summary">
              {t("git.fileCount", { count: groups.reduce((sum, group) => sum + group.fileCount, 0) })}
            </span>
          </div>

          <div className="git-review-panel__tree-filter">
            <input
              className="git-review-panel__filter-input"
              value={treeFilter}
              onChange={(event) => onTreeFilterChange(event.target.value)}
              placeholder={t("git.filterPlaceholder")}
            />
          </div>

          <div className="git-review-panel__tree-body" data-testid="git-file-tree">
            {!snapshot ? (
              <GitReviewEmptyState title={t("git.readingTreeTitle")} detail={t("git.readingTreeDetail")} />
            ) : !snapshot.isGitRepository ? (
              <GitReviewEmptyState title={t("git.notRepoTitle")} detail={t("git.notRepoInline")} />
            ) : groups.length === 0 ? (
              <GitReviewEmptyState
                title={treeFilter.trim() ? t("git.noTreeMatch") : t("git.noTree")}
                detail={
                  treeFilter.trim()
                    ? t("git.treeFilterEmptyDetail")
                    : t("git.cleanDetail")
                }
              />
            ) : (
              <div className="git-review-tree">
                {groups.map((group) => (
                  <GitReviewGroupSection
                    key={group.id}
                    group={group}
                    expanded={expandedGroupIds.includes(group.id)}
                    expandedDirectoryKeys={expandedDirectoryKeys}
                    selectedPath={visibleSelectedPath}
                    onToggleGroup={() =>
                      setExpandedGroupIds((current) =>
                        current.includes(group.id)
                          ? current.filter((id) => id !== group.id)
                          : [...current, group.id],
                      )
                    }
                    onToggleDirectory={(directoryKey) =>
                      setExpandedDirectoryKeys((current) =>
                        current.includes(directoryKey)
                          ? current.filter((key) => key !== directoryKey)
                          : [...current, directoryKey],
                      )
                    }
                    onSelectFile={handleSelectFile}
                  />
                ))}
              </div>
            )}
          </div>
        </aside>}

        {!isMobile && (
          <div
            className={
              treeResizing
                ? "git-review-panel__resizer git-review-panel__resizer--active"
                : "git-review-panel__resizer"
            }
            data-testid="git-workbench-resizer"
            role="separator"
            tabIndex={0}
            aria-label={t("git.resizeTreeAria")}
            aria-orientation="vertical"
            aria-valuemin={treeBounds.min}
            aria-valuemax={treeBounds.max}
            aria-valuenow={Math.round(treeWidth)}
            onPointerDown={onResizeStart}
            onKeyDown={onResizeKeyDown}
          />
        )}

        {(!isMobile || mobileView === "diff") && <section className="git-review-panel__diff">
          <div className="git-review-panel__diff-header">
            <div className="git-review-panel__diff-header-main">
              <p className="git-review-panel__eyebrow">{t("git.changedContent")}</p>
              <strong
                className="git-review-panel__diff-path"
                data-testid="git-review-path"
                title={
                  diffMode === "remote"
                    ? remoteDiff?.cwd ?? workspace.absPath
                    : selectedFile?.path ?? summary.title
                }
              >
                {diffMode === "remote"
                  ? t("git.remoteDiffTitle")
                  : selectedFile
                    ? compactReviewPath(selectedFile.path)
                    : summary.title}
              </strong>
              {diffMode === "remote" ? (
                <div className="git-review-panel__diff-meta">
                  <span>{remoteDiffLabel}</span>
                  <span title={remoteDiff?.cwd ?? workspace.absPath}>
                    {compactReviewPath(remoteDiff?.cwd ?? workspace.absPath)}
                  </span>
                </div>
              ) : selectedFile ? (
                <div className="git-review-panel__diff-meta">
                  <span className="git-review-panel__status-badge" title={formatGitFileBadge(t, selectedFile.status)}>
                    {formatGitFileShortStatus(selectedFile.status)}
                  </span>
                  <span>{formatGitFileBadge(t, selectedFile.status)}</span>
                  <span>{formatGitTrackingState(t, selectedFile)}</span>
                  {selectedFile.oldPath ? (
                    <span title={selectedFile.oldPath}>
                      {t("git.renamedFrom", { path: compactReviewPath(selectedFile.oldPath) })}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
            {diffMode === "remote" ? (
              remoteDiff ? (
                <div className="git-review-panel__diff-stats">
                  <span className="git-review-panel__remote-sha">{remoteDiff.sha}</span>
                </div>
              ) : null
            ) : selectedFile ? (
              <div className="git-review-panel__diff-stats">
                <span className="window-stat window-stat--positive">{`+${selectedFile.additions}`}</span>
                <span className="window-stat window-stat--negative">{`-${selectedFile.deletions}`}</span>
              </div>
            ) : null}
          </div>

          <div className="git-review-panel__diff-body">
            {diffMode === "remote" ? (
              remoteDiffLoading && !remoteDiff ? (
                <GitReviewEmptyState title={t("git.loadingRemoteDiffTitle")} detail={workspace.absPath} />
              ) : remoteDiffError && !remoteDiff ? (
                <GitReviewEmptyState title={t("git.remoteDiffFailedTitle")} detail={remoteDiffError} />
              ) : remoteDiff ? (
                remoteDiff.diff.trim() ? (
                  <div className="git-review-panel__fallback" data-testid="git-remote-diff-view">
                    <div className="git-review-panel__fallback-copy">
                      <strong>{t("git.remoteDiffTitle")}</strong>
                      <p>{t("git.remoteDiffReady")}</p>
                    </div>
                    <div className="terminal-output inspector-terminal-output">
                      <RenderableCodeBlock value={remoteDiff.diff} language="diff" />
                    </div>
                  </div>
                ) : (
                  <GitReviewEmptyState title={t("git.remoteDiffTitle")} detail={t("git.noDiffYet")} />
                )
              ) : (
                <GitReviewEmptyState title={t("git.remoteDiffTitle")} detail={t("git.noDiffYet")} />
              )
            ) : !selectedFile ? (
              <GitReviewEmptyState title={t("git.selectPatchHint")} detail={t("git.noDiffYet")} />
            ) : detailLoadingPath === selectedFile.path && !detail ? (
              <GitReviewEmptyState title={t("git.loadingDetailTitle")} detail={compactReviewPath(selectedFile.path)} />
            ) : detailError && !detail ? (
              <GitReviewEmptyState title={t("git.detailLoadFailedTitle")} detail={detailError} />
            ) : detail?.mode === "inline-diff" ? (
              <Suspense
                fallback={
                  <GitReviewEmptyState
                    title={t("git.loadingDetailTitle")}
                    detail={compactReviewPath(selectedFile.path)}
                  />
                }
              >
                <LazyGitDiffViewer
                  diffKey={`${snapshotIdentity}:${detail.path}`}
                  language={detail.language}
                  originalText={detail.originalText}
                  modifiedText={detail.modifiedText}
                />
              </Suspense>
            ) : detail ? (
              <div className="git-review-panel__fallback" data-testid="git-review-fallback">
                <div className="git-review-panel__fallback-copy">
                  <strong>
                    {detail.mode === "binary"
                      ? t("git.binaryFallbackTitle")
                      : detail.mode === "patch"
                        ? t("git.patchFallbackTitle")
                        : t("git.unavailableFallbackTitle")}
                  </strong>
                  <p>{detail.reason}</p>
                </div>
                <div className="terminal-output inspector-terminal-output">
                  <RenderableCodeBlock
                    value={detail.patch || t("git.noDiffYet")}
                    language="diff"
                  />
                </div>
              </div>
            ) : (
              <GitReviewEmptyState title={t("git.selectPatchHint")} detail={t("git.noDiffYet")} />
            )}
          </div>
        </section>}
      </div>
    </div>
  );
}

function GitReviewGroupSection(props: {
  group: GitReviewGroup;
  expanded: boolean;
  expandedDirectoryKeys: Array<string>;
  selectedPath: string | null;
  onToggleGroup: () => void;
  onToggleDirectory: (directoryKey: string) => void;
  onSelectFile: (path: string) => void;
}) {
  const { t } = useAppLocale();

  return (
    <section
      className="git-review-group"
      data-testid={`git-review-group-${props.group.id}`}
    >
      <button type="button" className="git-review-group__header" onClick={props.onToggleGroup}>
        <div className="git-review-group__header-main">
          <ChevronIcon expanded={props.expanded} />
          <strong>{formatGitReviewGroupLabel(t, props.group.id)}</strong>
          <span>{t("git.fileCount", { count: props.group.fileCount })}</span>
        </div>
        <div className="git-review-group__stats">
          <span className="window-stat window-stat--positive">{`+${props.group.additions}`}</span>
          <span className="window-stat window-stat--negative">{`-${props.group.deletions}`}</span>
        </div>
      </button>

      {props.expanded ? (
        <div className="git-review-group__body">
          {props.group.tree.map((node) => (
            <GitReviewTreeRow
              key={node.id}
              groupId={props.group.id}
              node={node}
              depth={0}
              expandedDirectoryKeys={props.expandedDirectoryKeys}
              selectedPath={props.selectedPath}
              onToggleDirectory={props.onToggleDirectory}
              onSelectFile={props.onSelectFile}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function GitReviewTreeRow(props: {
  groupId: GitReviewGroupId;
  node: GitReviewTreeNode;
  depth: number;
  expandedDirectoryKeys: Array<string>;
  selectedPath: string | null;
  onToggleDirectory: (directoryKey: string) => void;
  onSelectFile: (path: string) => void;
}) {
  const { t } = useAppLocale();
  const depthStyle = { "--tree-depth": props.depth } as CSSProperties;

  if (props.node.kind === "directory") {
    const expanded = props.expandedDirectoryKeys.includes(props.node.key);

    return (
      <div className="git-review-tree__branch">
        <button
          type="button"
          className="git-review-tree__row git-review-tree__row--directory"
          style={depthStyle}
          onClick={() => props.onToggleDirectory(props.node.key)}
        >
          <div className="git-review-tree__label">
            <ChevronIcon expanded={expanded} />
            <FolderIcon open={expanded} />
            <strong>{props.node.name}</strong>
          </div>
          <div className="git-review-tree__stats">
            <span className="git-review-tree__count">
              {t("git.fileCount", { count: props.node.fileCount })}
            </span>
            <span className="window-stat window-stat--positive">{`+${props.node.additions}`}</span>
            <span className="window-stat window-stat--negative">{`-${props.node.deletions}`}</span>
          </div>
        </button>
        {expanded ? (
          <div className="git-review-tree__children">
            {props.node.children.map((child) => (
              <GitReviewTreeRow
                key={child.id}
                groupId={props.groupId}
                node={child}
                depth={props.depth + 1}
                expandedDirectoryKeys={props.expandedDirectoryKeys}
                selectedPath={props.selectedPath}
                onToggleDirectory={props.onToggleDirectory}
                onSelectFile={props.onSelectFile}
              />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  const fileNode = props.node;
  const active = props.selectedPath === fileNode.file.path;
  return (
    <button
      type="button"
      className={
        active
          ? "git-review-tree__row git-review-tree__row--file git-review-tree__row--active"
          : "git-review-tree__row git-review-tree__row--file"
      }
      style={depthStyle}
      onClick={() => props.onSelectFile(fileNode.file.path)}
    >
      <div className="git-review-tree__label">
        <span
          className="git-review-tree__badge"
          title={formatGitFileBadge(t, fileNode.file.status)}
        >
          {formatGitFileShortStatus(fileNode.file.status)}
        </span>
        <span className="git-review-tree__file-name">{fileNode.name}</span>
      </div>
      <div className="git-review-tree__stats">
        <span className="window-stat window-stat--positive">{`+${fileNode.file.additions}`}</span>
        <span className="window-stat window-stat--negative">{`-${fileNode.file.deletions}`}</span>
      </div>
    </button>
  );
}

function GitReviewEmptyState(props: { title: string; detail: string }) {
  return (
    <div className="git-review-empty">
      <strong>{props.title}</strong>
      <p>{props.detail}</p>
    </div>
  );
}

function formatGitReviewGroupLabel(t: ReturnType<typeof useAppLocale>["t"], groupId: GitReviewGroupId): string {
  switch (groupId) {
    case "conflicted":
      return t("git.groups.conflicted");
    case "staged-unstaged":
      return t("git.groups.stagedAndUnstaged");
    case "staged":
      return t("git.groups.staged");
    case "unstaged":
      return t("git.groups.unstaged");
    case "untracked":
      return t("git.groups.untracked");
    default:
      return groupId;
  }
}

function formatGitTrackingState(
  t: ReturnType<typeof useAppLocale>["t"],
  file: GitWorkingTreeFile,
): string {
  if (file.oldPath) {
    return t("git.renamedState");
  }
  if (file.staged && file.unstaged) {
    return t("git.stagedAndUnstaged");
  }
  if (file.staged) {
    return t("git.stagedTracked");
  }
  if (file.status === "untracked") {
    return t("git.fileStatus.untracked");
  }
  if (file.unstaged) {
    return t("git.unstagedTracked");
  }
  return t("git.tracked");
}

function formatGitFileBadge(
  t: ReturnType<typeof useAppLocale>["t"],
  status: GitWorkingTreeFile["status"],
): string {
  switch (status) {
    case "modified":
      return t("git.fileStatus.modified");
    case "added":
      return t("git.fileStatus.added");
    case "deleted":
      return t("git.fileStatus.deleted");
    case "renamed":
      return t("git.fileStatus.renamed");
    case "copied":
      return t("git.fileStatus.copied");
    case "untracked":
      return t("git.fileStatus.untracked");
    case "typechange":
      return t("git.fileStatus.typechange");
    case "conflicted":
      return t("git.fileStatus.conflicted");
    default:
      return status;
  }
}

function formatGitFileShortStatus(status: GitWorkingTreeFile["status"]): string {
  switch (status) {
    case "modified":
      return "M";
    case "added":
      return "A";
    case "deleted":
      return "D";
    case "renamed":
      return "R";
    case "copied":
      return "C";
    case "untracked":
      return "U";
    case "typechange":
      return "T";
    case "conflicted":
      return "!";
    default:
      return "?";
  }
}

function compactReviewPath(path: string, keepSegments = 4): string {
  const segments = path.split("/").filter(Boolean);
  if (segments.length <= keepSegments) {
    return path;
  }

  return `${segments.slice(0, 2).join("/")}/…/${segments.slice(-2).join("/")}`;
}

function collectDirectoryKeys(groups: ReadonlyArray<GitReviewGroup>): Array<string> {
  const keys: Array<string> = [];

  const walk = (node: GitReviewTreeNode) => {
    if (node.kind !== "directory") {
      return;
    }

    keys.push(node.key);
    for (const child of node.children) {
      walk(child);
    }
  };

  for (const group of groups) {
    for (const node of group.tree) {
      walk(node);
    }
  }

  return keys;
}

function arraysEqual(left: Array<string>, right: Array<string>): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

function ChevronIcon(props: { expanded: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={props.expanded ? "git-review-icon git-review-icon--chevron git-review-icon--expanded" : "git-review-icon git-review-icon--chevron"}
    />
  );
}

function FolderIcon(props: { open: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={props.open ? "git-review-icon git-review-icon--folder git-review-icon--folder-open" : "git-review-icon git-review-icon--folder"}
    />
  );
}
