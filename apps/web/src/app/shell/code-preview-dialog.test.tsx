import { act, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAppLocale } from "../../i18n/init";
import { CodePreviewDialog } from "./code-preview-dialog";

type EditorProps = {
  path?: string;
  keepCurrentModel?: boolean;
  beforeMount?: (monaco: unknown) => void;
  onMount?: (editor: unknown, monaco: unknown) => void;
};

const latestEditorProps: { current: EditorProps | null } = {
  current: null,
};

const modelDisposals = new Map<string, { dispose: ReturnType<typeof vi.fn> }>();
const clearDecorations = vi.fn();
const revealLineInCenter = vi.fn();
const setPosition = vi.fn();
const createDecorationsCollection = vi.fn(() => ({
  clear: clearDecorations,
}));

const mockEditor = {
  revealLineInCenter,
  setPosition,
  createDecorationsCollection,
};

const mockMonaco = {
  Range: class {
    constructor(
      public startLine: number,
      public startColumn: number,
      public endLine: number,
      public endColumn: number,
    ) {}
  },
  Uri: {
    parse: (value: string) => value,
  },
  editor: {
    getModel: (uri: unknown) => modelDisposals.get(String(uri)) ?? null,
  },
};

vi.mock("@monaco-editor/react", () => ({
  __esModule: true,
  default: (props: EditorProps) => {
    latestEditorProps.current = props;

    useEffect(() => {
      props.beforeMount?.(mockMonaco);
      props.onMount?.(mockEditor, mockMonaco);
    }, [props]);

    return <div data-testid="mock-code-editor" />;
  },
}));

describe("CodePreviewDialog", () => {
  beforeEach(async () => {
    await setAppLocale("zh-CN");
    vi.useFakeTimers();
    latestEditorProps.current = null;
    modelDisposals.clear();
    clearDecorations.mockReset();
    revealLineInCenter.mockReset();
    setPosition.mockReset();
    createDecorationsCollection.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps preview models alive until the dialog unmounts, then clears decorations and disposes the model", () => {
    const { unmount } = render(
      <CodePreviewDialog
        reference={{
          path: "/Users/roy/Developments/webcli/apps/web/src/App.tsx",
          label: "App.tsx",
          line: 12,
          column: 3,
          href: "/Users/roy/Developments/webcli/apps/web/src/App.tsx#L12",
          resolvedHref: "/Users/roy/Developments/webcli/apps/web/src/App.tsx#L12",
        }}
        content="export const App = () => null;"
        loading={false}
        error={null}
        onClose={() => {}}
      />,
    );

    expect(screen.getByTestId("mock-code-editor")).toBeVisible();
    expect(latestEditorProps.current?.keepCurrentModel).toBe(true);
    expect(latestEditorProps.current?.path).toContain("inmemory://webcli/code-preview/");
    expect(revealLineInCenter).toHaveBeenCalledWith(12);
    expect(setPosition).toHaveBeenCalledWith({ lineNumber: 12, column: 3 });
    expect(createDecorationsCollection).toHaveBeenCalledTimes(1);

    const dispose = vi.fn();
    modelDisposals.set(latestEditorProps.current!.path!, { dispose });

    act(() => {
      unmount();
    });

    expect(clearDecorations).toHaveBeenCalledTimes(1);
    expect(dispose).not.toHaveBeenCalled();

    act(() => {
      vi.runAllTimers();
    });

    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
