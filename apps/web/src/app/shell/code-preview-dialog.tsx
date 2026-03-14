import Editor, { type OnMount } from "@monaco-editor/react";
import { useEffect, useMemo, useRef, type CSSProperties } from "react";
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

type MonacoModel = {
  dispose: () => void;
};

type MonacoNamespace = {
  Range: new (startLine: number, startColumn: number, endLine: number, endColumn: number) => unknown;
  Uri: {
    parse: (value: string) => unknown;
  };
  editor: {
    getModel: (uri: unknown) => MonacoModel | null;
  };
};

type MonacoDecorationCollection = {
  clear: () => void;
};

let codePreviewModelScope = 0;

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
  const monacoRef = useRef<MonacoNamespace | null>(null);
  const decorationsRef = useRef<MonacoDecorationCollection | null>(null);
  const mountedRef = useRef(true);
  const modelScopeRef = useRef<string>("");
  if (!modelScopeRef.current) {
    codePreviewModelScope += 1;
    modelScopeRef.current = `code-preview-${codePreviewModelScope}`;
  }

  const language = useMemo(() => inferCodeLanguage(props.reference.path), [props.reference.path]);
  const modelPath = useMemo(
    () => buildCodePreviewModelPath(modelScopeRef.current, props.reference.path),
    [props.reference.path],
  );
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

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      decorationsRef.current?.clear();
      decorationsRef.current = null;
      const monaco = monacoRef.current;
      window.setTimeout(() => {
        disposeMonacoModel(monaco, modelPath);
      }, 0);
    };
  }, [modelPath]);

  const handleEditorMount = useMemo<OnMount>(
    () => (editor, monaco) => {
      monacoRef.current = monaco as MonacoNamespace;
      decorationsRef.current?.clear();
      decorationsRef.current = null;

      if (!mountedRef.current) {
        return;
      }

      if (props.reference.line === null) {
        return;
      }

      const lineNumber = Math.max(1, props.reference.line);
      const column = Math.max(1, props.reference.column ?? 1);
      editor.revealLineInCenter(lineNumber);
      editor.setPosition({ lineNumber, column });
      decorationsRef.current = editor.createDecorationsCollection([
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
              key={modelPath}
              height="100%"
              path={modelPath}
              language={language}
              theme="vs-dark"
              value={props.content}
              keepCurrentModel
              beforeMount={(monaco) => {
                monacoRef.current = monaco as MonacoNamespace;
              }}
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

function buildCodePreviewModelPath(scope: string, filePath: string): string {
  return `inmemory://webcli/code-preview/${scope}/${encodeURIComponent(filePath)}`;
}

function disposeMonacoModel(monaco: MonacoNamespace | null, modelPath: string): void {
  if (!monaco) {
    return;
  }

  monaco.editor.getModel(monaco.Uri.parse(modelPath))?.dispose();
}
