import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  GitFileReviewDetail,
  GitWorkingTreeSnapshot,
  WorkspaceRecord,
} from "@webcli/contracts";
import { setAppLocale } from "../../i18n/init";
import { GitReviewPanel } from "./git-review-panel";

vi.mock("@monaco-editor/react", () => ({
  DiffEditor: (props: { original: string; modified: string }) => (
    <div data-testid="mock-diff-editor">
      <pre>{props.original}</pre>
      <pre>{props.modified}</pre>
    </div>
  ),
}));

const workspace: WorkspaceRecord = {
  id: "workspace-1",
  name: "Workspace",
  absPath: "/srv/project",
  source: "saved",
  createdAt: "2026-03-12T00:00:00.000Z",
  updatedAt: "2026-03-12T00:00:00.000Z",
  defaultModel: null,
  approvalPolicy: "on-request",
  sandboxMode: "danger-full-access",
};

const snapshot: GitWorkingTreeSnapshot = {
  workspaceId: workspace.id,
  workspaceName: workspace.name,
  repoRoot: workspace.absPath,
  branch: "main",
  isGitRepository: true,
  clean: false,
  stagedCount: 0,
  unstagedCount: 2,
  untrackedCount: 0,
  generatedAt: 123,
  files: [
    {
      path: "README.md",
      status: "modified",
      staged: false,
      unstaged: true,
      additions: 2,
      deletions: 1,
      patch: "diff --git a/README.md b/README.md\n+new",
      oldPath: null,
    },
    {
      path: "docs/review/notes.md",
      status: "conflicted",
      staged: false,
      unstaged: true,
      additions: 5,
      deletions: 2,
      patch: "diff --cc docs/review/notes.md\n<<<<<<< HEAD",
      oldPath: null,
    },
  ],
};

const details: Record<string, GitFileReviewDetail> = {
  "README.md": {
    path: "README.md",
    oldPath: null,
    status: "modified",
    language: "markdown",
    mode: "inline-diff",
    originalText: "old",
    modifiedText: "new",
  },
  "docs/review/notes.md": {
    path: "docs/review/notes.md",
    oldPath: null,
    status: "conflicted",
    language: "markdown",
    mode: "patch",
    patch: "diff --cc docs/review/notes.md\n<<<<<<< HEAD",
    reason: "Merge conflicts are shown as raw patch output.",
  },
};

function Harness(props: { initialSelectedPath?: string | null }) {
  const [selectedPath, setSelectedPath] = useState<string | null>(
    props.initialSelectedPath ?? null,
  );
  const [treeFilter, setTreeFilter] = useState("");

  return (
    <GitReviewPanel
      workspace={workspace}
      snapshot={snapshot}
      selectedPath={selectedPath}
      treeFilter={treeFilter}
      treeWidth={340}
      treeBounds={{ min: 260, max: 520 }}
      treeResizing={false}
      onClose={() => {}}
      onSelectFile={setSelectedPath}
      onTreeFilterChange={setTreeFilter}
      onRefresh={() => {}}
      onReadFileDetail={async (path) => details[path]}
      onResizeStart={() => {}}
      onResizeKeyDown={() => {}}
    />
  );
}

describe("GitReviewPanel", () => {
  beforeEach(async () => {
    await setAppLocale("zh-CN");
  });

  it("renders grouped tree sections and inline diff content", async () => {
    render(<Harness initialSelectedPath="README.md" />);

    expect(screen.getByTestId("git-review-group-conflicted")).toBeVisible();
    expect(screen.getByTestId("git-review-group-unstaged")).toBeVisible();

    await waitFor(() => expect(screen.getByTestId("mock-diff-editor")).toBeVisible());
    expect(screen.getByTestId("git-review-path")).toHaveTextContent("README.md");
  });

  it("supports expanding nested directories and falling back to patch view", async () => {
    render(<Harness initialSelectedPath="README.md" />);

    await waitFor(() => expect(screen.getByTestId("mock-diff-editor")).toBeVisible());
    expect(screen.getByRole("button", { name: /docs/i })).toBeVisible();
    fireEvent.click(await screen.findByRole("button", { name: /review/i }));
    fireEvent.click(screen.getByRole("button", { name: /notes.md/i }));

    await waitFor(() => expect(screen.getByTestId("git-review-fallback")).toBeVisible());
    expect(screen.getByTestId("git-review-fallback")).toHaveTextContent("Merge conflicts");
  });
});
