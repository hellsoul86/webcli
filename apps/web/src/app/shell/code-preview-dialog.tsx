import Editor, { type OnMount } from "@monaco-editor/react";
import { useMemo, type CSSProperties } from "react";
import { formatNumber } from "../../i18n/format";
import { useAppLocale } from "../../i18n/use-i18n";
import {
  inferCodeLanguage,
  type CodeLinkReference,
} from "../../shared/workbench/renderable-content";

type CodePreviewDialogProps = {
  reference: CodeLinkReference;
  content: string;
  loading: boolean;
  error: string | null;
  onClose: () => void;
};

const centeredModalOverlayStyle: CSSProperties = {
  pointerEvents: "none",
  justifyItems: "center",
  alignItems: "center",
};

const interactiveOverlayPanelStyle: CSSProperties = {
  pointerEvents: "auto",
};

export function CodePreviewDialog(props: CodePreviewDialogProps) {
  const { t } = useAppLocale();
  const language = useMemo(() => inferCodeLanguage(props.reference.path), [props.reference.path]);
  const fileName =
    props.reference.label?.trim() || props.reference.path.split("/").pop() || props.reference.path;
  const locationLabel =
    props.reference.line !== null
      ? props.reference.column !== null
        ? t("modal.lineColumn", {
            line: formatNumber(props.reference.line),
            column: formatNumber(props.reference.column),
          })
        : t("modal.line", { line: formatNumber(props.reference.line) })
      : null;

  const handleEditorMount = useMemo<OnMount>(
    () => (editor, monaco) => {
      if (props.reference.line === null) {
        return;
      }

      const lineNumber = Math.max(1, props.reference.line);
      const column = Math.max(1, props.reference.column ?? 1);
      editor.revealLineInCenter(lineNumber);
      editor.setPosition({ lineNumber, column });
      editor.createDecorationsCollection([
        {
          range: new monaco.Range(lineNumber, 1, lineNumber, 1),
          options: {
            isWholeLine: true,
            className: "code-preview__line-highlight",
            linesDecorationsClassName: "code-preview__line-gutter",
          },
        },
      ]);
    },
    [props.reference.column, props.reference.line],
  );

  return (
    <div className="overlay-shell" style={centeredModalOverlayStyle}>
      <div
        className="modal-panel code-preview-modal"
        style={interactiveOverlayPanelStyle}
        data-testid="code-preview-modal"
      >
        <div className="modal-panel__header">
          <div>
            <p className="settings-sidebar__eyebrow">{t("modal.codePreview")}</p>
            <strong data-testid="code-preview-title">{fileName}</strong>
            <div className="conversation-header__meta">
              <span>{compactPath(props.reference.path, 5)}</span>
              {locationLabel ? (
                <>
                  <span>·</span>
                  <span>{locationLabel}</span>
                </>
              ) : null}
              <span>·</span>
              <span>{language}</span>
            </div>
          </div>
          <button className="ghost-button" onClick={props.onClose}>
            {t("common.close")}
          </button>
        </div>

        {props.loading ? (
          <div className="inspector-empty" style={{ height: "100%" }}>
            <strong>{t("modal.loadingCode")}</strong>
            <p>{compactPath(props.reference.path, 5)}</p>
          </div>
        ) : null}

        {!props.loading && props.error ? (
          <div className="inspector-empty" style={{ height: "100%" }}>
            <strong>{t("modal.codePreviewFailed")}</strong>
            <p>{props.error}</p>
          </div>
        ) : null}

        {!props.loading && !props.error ? (
          <div className="code-preview-editor" data-testid="code-preview-editor">
            <Editor
              key={`${props.reference.path}:${props.reference.line ?? 0}:${props.reference.column ?? 0}`}
              height="100%"
              path={props.reference.path}
              language={language}
              theme="vs-dark"
              value={props.content}
              onMount={handleEditorMount}
              options={{
                readOnly: true,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                wordWrap: "on",
                lineNumbers: "on",
                glyphMargin: false,
                folding: true,
                renderLineHighlight: "all",
                padding: {
                  top: 14,
                  bottom: 14,
                },
              }}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function compactPath(value: string, keepSegments = 3): string {
  const parts = value.split("/").filter(Boolean);
  if (parts.length <= keepSegments) {
    return value;
  }

  return `.../${parts.slice(-keepSegments).join("/")}`;
}
