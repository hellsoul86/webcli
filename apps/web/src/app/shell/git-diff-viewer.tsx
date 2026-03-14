import { DiffEditor } from "@monaco-editor/react";
import { useEffect, useMemo, useRef } from "react";

type GitDiffViewerProps = {
  diffKey: string;
  language?: string | null;
  originalText: string;
  modifiedText: string;
};

type MonacoModel = {
  dispose: () => void;
};

type MonacoNamespace = {
  Uri: {
    parse: (value: string) => unknown;
  };
  editor: {
    getModel: (uri: unknown) => MonacoModel | null;
  };
};

let gitDiffViewerModelScope = 0;

export function GitDiffViewer(props: GitDiffViewerProps) {
  const monacoRef = useRef<MonacoNamespace | null>(null);
  const modelScopeRef = useRef<string>("");
  if (!modelScopeRef.current) {
    gitDiffViewerModelScope += 1;
    modelScopeRef.current = `git-diff-${gitDiffViewerModelScope}`;
  }

  const modelPaths = useMemo(
    () => buildDiffModelPaths(modelScopeRef.current, props.diffKey),
    [props.diffKey],
  );

  useEffect(() => {
    return () => {
      const monaco = monacoRef.current;
      window.setTimeout(() => {
        disposeMonacoModel(monaco, modelPaths.original);
        disposeMonacoModel(monaco, modelPaths.modified);
      }, 0);
    };
  }, [modelPaths.modified, modelPaths.original]);

  return (
    <div className="git-review-panel__editor" data-testid="git-review-diff-viewer">
      <DiffEditor
        theme="vs-dark"
        language={props.language ?? undefined}
        original={props.originalText}
        modified={props.modifiedText}
        originalModelPath={modelPaths.original}
        modifiedModelPath={modelPaths.modified}
        keepCurrentOriginalModel
        keepCurrentModifiedModel
        beforeMount={(monaco) => {
          monacoRef.current = monaco as MonacoNamespace;
        }}
        onMount={(_editor, monaco) => {
          monacoRef.current = monaco as MonacoNamespace;
        }}
        options={{
          readOnly: true,
          renderSideBySide: false,
          originalEditable: false,
          scrollBeyondLastLine: false,
          minimap: { enabled: false },
          glyphMargin: false,
          folding: true,
          lineNumbers: "on",
          renderIndicators: true,
          renderOverviewRuler: false,
          diffCodeLens: false,
          wordWrap: "off",
          stickyScroll: { enabled: false },
        }}
      />
    </div>
  );
}

function buildDiffModelPaths(
  scope: string,
  diffKey: string,
): { original: string; modified: string } {
  const encodedKey = encodeURIComponent(diffKey);
  return {
    original: `inmemory://webcli/git-review/${scope}/${encodedKey}.original`,
    modified: `inmemory://webcli/git-review/${scope}/${encodedKey}.modified`,
  };
}

function disposeMonacoModel(monaco: MonacoNamespace | null, modelPath: string): void {
  if (!monaco) {
    return;
  }

  monaco.editor.getModel(monaco.Uri.parse(modelPath))?.dispose();
}
