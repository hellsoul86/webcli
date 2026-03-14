import { DiffEditor } from "@monaco-editor/react";

type GitDiffViewerProps = {
  diffKey: string;
  language?: string | null;
  originalText: string;
  modifiedText: string;
};

export function GitDiffViewer(props: GitDiffViewerProps) {
  return (
    <div className="git-review-panel__editor" data-testid="git-review-diff-viewer">
      <DiffEditor
        key={props.diffKey}
        theme="vs-dark"
        language={props.language ?? undefined}
        original={props.originalText}
        modified={props.modifiedText}
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
