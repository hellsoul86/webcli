import { act, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitDiffViewer } from "./git-diff-viewer";

type DiffEditorProps = {
  originalModelPath?: string;
  modifiedModelPath?: string;
  keepCurrentOriginalModel?: boolean;
  keepCurrentModifiedModel?: boolean;
  beforeMount?: (monaco: unknown) => void;
  onMount?: (editor: unknown, monaco: unknown) => void;
};

const latestDiffEditorProps: { current: DiffEditorProps | null } = {
  current: null,
};

const diffModels = new Map<string, { dispose: ReturnType<typeof vi.fn> }>();

const mockMonaco = {
  Uri: {
    parse: (value: string) => value,
  },
  editor: {
    getModel: (uri: unknown) => diffModels.get(String(uri)) ?? null,
  },
};

vi.mock("@monaco-editor/react", () => ({
  DiffEditor: (props: DiffEditorProps) => {
    latestDiffEditorProps.current = props;

    useEffect(() => {
      props.beforeMount?.(mockMonaco);
      props.onMount?.({}, mockMonaco);
    }, [props]);

    return <div data-testid="mock-diff-editor" />;
  },
}));

describe("GitDiffViewer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    diffModels.clear();
    latestDiffEditorProps.current = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps diff models alive until unmount cleanup disposes them", () => {
    const { unmount } = render(
      <GitDiffViewer
        diffKey="workspace:file.ts"
        language="typescript"
        originalText="const before = 1;"
        modifiedText="const after = 2;"
      />,
    );

    expect(screen.getByTestId("mock-diff-editor")).toBeVisible();
    expect(latestDiffEditorProps.current?.keepCurrentOriginalModel).toBe(true);
    expect(latestDiffEditorProps.current?.keepCurrentModifiedModel).toBe(true);
    expect(latestDiffEditorProps.current?.originalModelPath).toContain("inmemory://webcli/git-review/");
    expect(latestDiffEditorProps.current?.modifiedModelPath).toContain("inmemory://webcli/git-review/");

    const originalDispose = vi.fn();
    const modifiedDispose = vi.fn();
    diffModels.set(latestDiffEditorProps.current!.originalModelPath!, { dispose: originalDispose });
    diffModels.set(latestDiffEditorProps.current!.modifiedModelPath!, { dispose: modifiedDispose });

    act(() => {
      unmount();
    });

    expect(originalDispose).not.toHaveBeenCalled();
    expect(modifiedDispose).not.toHaveBeenCalled();

    act(() => {
      vi.runAllTimers();
    });

    expect(originalDispose).toHaveBeenCalledTimes(1);
    expect(modifiedDispose).toHaveBeenCalledTimes(1);
  });
});
