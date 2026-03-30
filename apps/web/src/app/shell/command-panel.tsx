import { memo, useRef, useEffect } from "react";
import type { CommandSessionSnapshot } from "@webcli/contracts";
import { useAppLocale } from "../../i18n/use-i18n";

type CommandPanelProps = {
  workspace: { id: string; name: string } | null;
  session: CommandSessionSnapshot | null;
  commandInput: string;
  stdinInput: string;
  onCommandInputChange: (value: string) => void;
  onStdinInputChange: (value: string) => void;
  onRunCommand: () => void;
  onSendStdin: () => void;
  onTerminate: () => void;
  onClose: () => void;
};

export const CommandPanel = memo(function CommandPanel(props: CommandPanelProps) {
  const { t } = useAppLocale();
  const outputRef = useRef<HTMLPreElement | null>(null);

  // Auto-scroll output to bottom
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [props.session?.stdout, props.session?.stderr]);

  const isRunning = props.session?.status === "running";
  const hasSession = props.session !== null;
  const output = props.session
    ? `${props.session.stdout}${props.session.stderr ? `\n${props.session.stderr}` : ""}`
    : "";

  return (
    <section className="command-panel" data-testid="command-panel">
      <div className="command-panel__header">
        <span className="command-panel__title">{t("command.title")}</span>
        {props.workspace ? (
          <span className="command-panel__workspace">{props.workspace.name}</span>
        ) : null}
        <button
          type="button"
          className="ghost-button command-panel__close"
          onClick={props.onClose}
        >
          {t("command.close")}
        </button>
      </div>

      {/* Command input row */}
      <div className="command-panel__input-row">
        <input
          type="text"
          className="command-panel__command-input"
          data-testid="command-input"
          value={props.commandInput}
          onChange={(e) => props.onCommandInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !isRunning) {
              props.onRunCommand();
            }
          }}
          placeholder={t("command.inputPlaceholder")}
          disabled={isRunning}
        />
        {isRunning ? (
          <button
            type="button"
            className="command-panel__stop-button"
            data-testid="command-stop-button"
            onClick={props.onTerminate}
          >
            {t("command.stop")}
          </button>
        ) : (
          <button
            type="button"
            className="command-panel__run-button"
            data-testid="command-run-button"
            onClick={props.onRunCommand}
            disabled={!props.workspace || !props.commandInput.trim()}
          >
            {t("command.run")}
          </button>
        )}
      </div>

      {/* Terminal output */}
      {hasSession ? (
        <div className="command-panel__terminal">
          <div className="command-panel__status-bar">
            <code className="command-panel__cmd">{props.session!.command}</code>
            <span
              className={`command-panel__status command-panel__status--${props.session!.status}`}
              data-testid="command-status"
            >
              {getStatusLabel(props.session!.status, props.session!.exitCode)}
            </span>
          </div>
          <pre
            ref={outputRef}
            className="command-panel__output"
            data-testid="command-output"
          >
            {output || t("command.waitingForOutput")}
          </pre>

          {/* Stdin input (only when running and allowStdin) */}
          {isRunning && props.session!.allowStdin ? (
            <div className="command-panel__stdin-row">
              <input
                type="text"
                className="command-panel__stdin-input"
                data-testid="command-stdin-input"
                value={props.stdinInput}
                onChange={(e) => props.onStdinInputChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    props.onSendStdin();
                  }
                }}
                placeholder={t("command.stdinPlaceholder")}
              />
              <button
                type="button"
                className="command-panel__send-button"
                data-testid="command-stdin-send"
                onClick={props.onSendStdin}
                disabled={!props.stdinInput}
              >
                {t("command.send")}
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="command-panel__empty" data-testid="command-empty">
          <p>{t("command.emptyDescription")}</p>
        </div>
      )}
    </section>
  );
});

function getStatusLabel(
  status: CommandSessionSnapshot["status"],
  exitCode: number | null,
): string {
  switch (status) {
    case "running":
      return "Running";
    case "completed":
      return exitCode === 0 ? "Completed" : `Exit ${exitCode}`;
    case "failed":
      return "Failed";
    default:
      return status;
  }
}
