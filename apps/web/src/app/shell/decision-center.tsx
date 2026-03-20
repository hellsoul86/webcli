import { useState, type ReactNode } from "react";
import {
  buildDefaultServerRequestResolveInput,
  type DynamicToolCallOutputContentItem,
  type JsonValue,
  type PendingServerRequest,
  type ServerRequestResolveInput,
} from "@webcli/contracts";
import { useAppLocale } from "../../i18n/use-i18n";
import { RenderableCodeBlock, RenderableMarkdown } from "../../shared/workbench/renderable-content";

type DecisionCenterProps = {
  requests: Array<PendingServerRequest>;
  onResolve: (resolution: ServerRequestResolveInput) => Promise<void>;
};

export function DecisionCenter(props: DecisionCenterProps) {
  const { t } = useAppLocale();
  if (props.requests.length === 0) {
    return null;
  }

  return (
    <section className="decision-center" data-testid="decision-center">
      <div className="inspector-section__header">
        <strong>{t("decisionCenter.title")}</strong>
        <span>{props.requests.length}</span>
      </div>
      <p className="decision-center__eyebrow">{t("decisionCenter.subtitle")}</p>
      <div className="decision-center__list">
        {props.requests.map((request) => (
          <DecisionRequestCard key={String(request.id)} request={request} onResolve={props.onResolve} />
        ))}
      </div>
    </section>
  );
}

function DecisionRequestCard(props: {
  request: PendingServerRequest;
  onResolve: (resolution: ServerRequestResolveInput) => Promise<void>;
}) {
  switch (props.request.kind) {
    case "commandExecutionApproval":
      return <CommandExecutionApprovalCard {...props} />;
    case "fileChangeApproval":
      return <FileChangeApprovalCard {...props} />;
    case "requestUserInput":
      return <RequestUserInputCard {...props} />;
    case "mcpServerElicitation":
      return <McpServerElicitationCard {...props} />;
    case "permissionsApproval":
      return <PermissionsApprovalCard {...props} />;
    case "dynamicToolCall":
      return <DynamicToolCallCard {...props} />;
    case "chatgptAuthTokensRefresh":
      return <ChatgptAuthTokensRefreshCard {...props} />;
    case "applyPatchApproval":
      return <ApplyPatchApprovalCard {...props} />;
    case "execCommandApproval":
      return <ExecCommandApprovalCard {...props} />;
  }
}

function DecisionCardChrome(props: {
  request: PendingServerRequest;
  title: string;
  badge?: string | null;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  const { t } = useAppLocale();
  return (
    <article
      className={`decision-card decision-card--${props.request.kind}`}
      data-testid={`decision-card-${String(props.request.id)}`}
    >
      <div className="decision-card__header">
        <div>
          <span className="decision-card__eyebrow">{t("decisionCenter.requestLabel")}</span>
          <strong>{props.title}</strong>
        </div>
        {props.badge ? <span className="decision-card__badge">{props.badge}</span> : null}
      </div>
      <div className="decision-card__meta">
        {props.request.threadId ? (
          <span>{t("decisionCenter.meta.thread", { value: props.request.threadId })}</span>
        ) : null}
        {props.request.turnId ? (
          <span>{t("decisionCenter.meta.turn", { value: props.request.turnId })}</span>
        ) : null}
        {props.request.itemId ? (
          <span>{t("decisionCenter.meta.item", { value: props.request.itemId })}</span>
        ) : null}
      </div>
      {props.children ? <div className="decision-card__body">{props.children}</div> : null}
      {props.actions ? <div className="decision-actions">{props.actions}</div> : null}
    </article>
  );
}

function CommandExecutionApprovalCard(props: {
  request: PendingServerRequest;
  onResolve: (resolution: ServerRequestResolveInput) => Promise<void>;
}) {
  const { t } = useAppLocale();
  const params = asRecord(props.request.params);
  const command = readString(params.command);
  const cwd = readString(params.cwd);
  const reason = readString(params.reason);
  const availableDecisions = Array.isArray(params.availableDecisions)
    ? params.availableDecisions
    : [];
  const supportsSession = availableDecisions.some((entry) => entry === "acceptForSession");

  return (
    <DecisionCardChrome
      request={props.request}
      title={t("decisionCenter.kinds.commandExecutionApproval")}
      badge={readString(params.approvalId) ?? null}
      actions={
        <>
          <button
            className="primary-button"
            data-testid={`decision-accept-${String(props.request.id)}`}
            onClick={() =>
              void props.onResolve(buildDefaultServerRequestResolveInput(props.request, "accept"))
            }
          >
            {t("common.accept")}
          </button>
          {supportsSession ? (
            <button
              className="ghost-button"
              data-testid={`decision-session-${String(props.request.id)}`}
              onClick={() =>
                void props.onResolve({
                  requestId: props.request.id,
                  kind: "commandExecutionApproval",
                  resolution: {
                    decision: "acceptForSession",
                  },
                })
              }
            >
              {t("decisionCenter.allowForSession")}
            </button>
          ) : null}
          <button
            className="ghost-button"
            data-testid={`decision-decline-${String(props.request.id)}`}
            onClick={() =>
              void props.onResolve(buildDefaultServerRequestResolveInput(props.request, "decline"))
            }
          >
            {t("common.decline")}
          </button>
        </>
      }
    >
      {command ? (
        <div className="decision-card__section">
          <span className="decision-card__label">{t("decisionCenter.labels.command")}</span>
          <RenderableCodeBlock value={command} language="bash" />
        </div>
      ) : null}
      {cwd ? <DecisionMetaLine label={t("decisionCenter.labels.cwd")} value={cwd} /> : null}
      {reason ? <DecisionTextBlock label={t("decisionCenter.labels.reason")} value={reason} /> : null}
      {params.commandActions ? (
        <DecisionJsonBlock
          label={t("decisionCenter.labels.commandActions")}
          value={params.commandActions}
        />
      ) : null}
      {params.additionalPermissions ? (
        <DecisionJsonBlock
          label={t("decisionCenter.labels.additionalPermissions")}
          value={params.additionalPermissions}
        />
      ) : null}
    </DecisionCardChrome>
  );
}

function FileChangeApprovalCard(props: {
  request: PendingServerRequest;
  onResolve: (resolution: ServerRequestResolveInput) => Promise<void>;
}) {
  const { t } = useAppLocale();
  const params = asRecord(props.request.params);
  const reason = readString(params.reason);
  const grantRoot = readString(params.grantRoot);
  return (
    <DecisionCardChrome
      request={props.request}
      title={t("decisionCenter.kinds.fileChangeApproval")}
      actions={
        <>
          <button
            className="primary-button"
            data-testid={`decision-accept-${String(props.request.id)}`}
            onClick={() =>
              void props.onResolve(buildDefaultServerRequestResolveInput(props.request, "accept"))
            }
          >
            {t("common.accept")}
          </button>
          <button
            className="ghost-button"
            data-testid={`decision-decline-${String(props.request.id)}`}
            onClick={() =>
              void props.onResolve(buildDefaultServerRequestResolveInput(props.request, "decline"))
            }
          >
            {t("common.decline")}
          </button>
        </>
      }
    >
      {reason ? <DecisionTextBlock label={t("decisionCenter.labels.reason")} value={reason} /> : null}
      {grantRoot ? (
        <DecisionMetaLine label={t("decisionCenter.labels.grantRoot")} value={grantRoot} />
      ) : null}
    </DecisionCardChrome>
  );
}

function RequestUserInputCard(props: {
  request: PendingServerRequest;
  onResolve: (resolution: ServerRequestResolveInput) => Promise<void>;
}) {
  const { t } = useAppLocale();
  const questions = readQuestions(props.request.params);
  const [answers, setAnswers] = useState<Record<string, Array<string>>>(() =>
    Object.fromEntries(
      questions.map((question) => [question.id, question.options?.[0]?.label ? [question.options[0].label] : []]),
    ),
  );
  const [otherAnswers, setOtherAnswers] = useState<Record<string, string>>({});

  return (
    <DecisionCardChrome
      request={props.request}
      title={t("decisionCenter.kinds.requestUserInput")}
      actions={
        <>
          <button
            className="primary-button"
            data-testid={`decision-submit-${String(props.request.id)}`}
            onClick={() =>
              void props.onResolve({
                requestId: props.request.id,
                kind: "requestUserInput",
                resolution: {
                  answers: Object.fromEntries(
                    questions.map((question) => {
                      const selected = answers[question.id] ?? [];
                      const other = otherAnswers[question.id]?.trim();
                      return [
                        question.id,
                        {
                          answers: other ? [...selected.filter(Boolean), other] : selected.filter(Boolean),
                        },
                      ];
                    }),
                  ),
                },
              })
            }
          >
            {t("decisionCenter.submitAnswers")}
          </button>
          <button
            className="ghost-button"
            data-testid={`decision-decline-${String(props.request.id)}`}
            onClick={() =>
              void props.onResolve({
                requestId: props.request.id,
                kind: "requestUserInput",
                resolution: {
                  answers: {},
                },
              })
            }
          >
            {t("common.decline")}
          </button>
        </>
      }
    >
      {questions.map((question) => (
        <div key={question.id} className="decision-form__field">
          <label className="decision-form__label">
            <strong>{question.header}</strong>
            <span>{question.question}</span>
          </label>
          {question.options && question.options.length > 0 ? (
            <select
              className="workspace-form__input"
              value={(answers[question.id] ?? [])[0] ?? ""}
              onChange={(event) =>
                setAnswers((current) => ({
                  ...current,
                  [question.id]: event.target.value ? [event.target.value] : [],
                }))
              }
            >
              <option value="">{t("decisionCenter.selectPlaceholder")}</option>
              {question.options.map((option) => (
                <option key={option.label} value={option.label}>
                  {option.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              className="workspace-form__input"
              type={question.isSecret ? "password" : "text"}
              value={(answers[question.id] ?? [])[0] ?? ""}
              onChange={(event) =>
                setAnswers((current) => ({
                  ...current,
                  [question.id]: event.target.value ? [event.target.value] : [],
                }))
              }
            />
          )}
          {question.isOther ? (
            <input
              className="workspace-form__input"
              placeholder={t("decisionCenter.otherAnswer")}
              value={otherAnswers[question.id] ?? ""}
              onChange={(event) =>
                setOtherAnswers((current) => ({
                  ...current,
                  [question.id]: event.target.value,
                }))
              }
            />
          ) : null}
        </div>
      ))}
    </DecisionCardChrome>
  );
}

function McpServerElicitationCard(props: {
  request: PendingServerRequest;
  onResolve: (resolution: ServerRequestResolveInput) => Promise<void>;
}) {
  const { t } = useAppLocale();
  const params = asRecord(props.request.params);
  const mode = params.mode === "url" ? "url" : "form";
  const [formState, setFormState] = useState<Record<string, JsonValue>>(() =>
    buildInitialElicitationFormState(params),
  );

  return (
    <DecisionCardChrome
      request={props.request}
      title={t("decisionCenter.kinds.mcpServerElicitation")}
      badge={readString(params.serverName) ?? null}
      actions={
        <>
          {mode === "url" && readString(params.url) ? (
            <button
              className="ghost-button"
              onClick={() => window.open(readString(params.url) ?? "", "_blank", "noopener,noreferrer")}
            >
              {t("common.open")}
            </button>
          ) : null}
          <button
            className="primary-button"
            data-testid={`decision-submit-${String(props.request.id)}`}
            onClick={() =>
              void props.onResolve({
                requestId: props.request.id,
                kind: "mcpServerElicitation",
                resolution: {
                  action: "accept",
                  content: mode === "form" ? formState : null,
                  _meta: (params._meta as JsonValue | null | undefined) ?? null,
                },
              })
            }
          >
            {t("common.accept")}
          </button>
          <button
            className="ghost-button"
            onClick={() =>
              void props.onResolve({
                requestId: props.request.id,
                kind: "mcpServerElicitation",
                resolution: {
                  action: "decline",
                  content: null,
                  _meta: (params._meta as JsonValue | null | undefined) ?? null,
                },
              })
            }
          >
            {t("common.decline")}
          </button>
          <button
            className="ghost-button"
            onClick={() =>
              void props.onResolve({
                requestId: props.request.id,
                kind: "mcpServerElicitation",
                resolution: {
                  action: "cancel",
                  content: null,
                  _meta: (params._meta as JsonValue | null | undefined) ?? null,
                },
              })
            }
          >
            {t("decisionCenter.cancel")}
          </button>
        </>
      }
    >
      {readString(params.message) ? (
        <DecisionTextBlock label={t("decisionCenter.labels.message")} value={readString(params.message) ?? ""} />
      ) : null}
      {mode === "url" ? (
        readString(params.url) ? (
          <DecisionMetaLine label={t("decisionCenter.labels.url")} value={readString(params.url) ?? ""} />
        ) : null
      ) : (
        <McpElicitationForm params={params} formState={formState} onChange={setFormState} />
      )}
    </DecisionCardChrome>
  );
}

function PermissionsApprovalCard(props: {
  request: PendingServerRequest;
  onResolve: (resolution: ServerRequestResolveInput) => Promise<void>;
}) {
  const { t } = useAppLocale();
  const params = asRecord(props.request.params);
  const permissions = asRecord(params.permissions);
  return (
    <DecisionCardChrome
      request={props.request}
      title={t("decisionCenter.kinds.permissionsApproval")}
      actions={
        <>
          <button
            className="primary-button"
            data-testid={`decision-accept-${String(props.request.id)}`}
            onClick={() =>
              void props.onResolve(buildDefaultServerRequestResolveInput(props.request, "accept"))
            }
          >
            {t("common.accept")}
          </button>
          <button
            className="ghost-button"
            data-testid={`decision-decline-${String(props.request.id)}`}
            onClick={() =>
              void props.onResolve({
                requestId: props.request.id,
                kind: "permissionsApproval",
                resolution: {
                  permissions: {},
                },
              })
            }
          >
            {t("common.decline")}
          </button>
        </>
      }
    >
      {readString(params.reason) ? (
        <DecisionTextBlock label={t("decisionCenter.labels.reason")} value={readString(params.reason) ?? ""} />
      ) : null}
      <DecisionJsonBlock label={t("decisionCenter.labels.permissions")} value={permissions} />
    </DecisionCardChrome>
  );
}

function DynamicToolCallCard(props: {
  request: PendingServerRequest;
  onResolve: (resolution: ServerRequestResolveInput) => Promise<void>;
}) {
  const { t } = useAppLocale();
  const params = asRecord(props.request.params);
  const [responseText, setResponseText] = useState("");

  return (
    <DecisionCardChrome
      request={props.request}
      title={t("decisionCenter.kinds.dynamicToolCall")}
      badge={readString(params.tool) ?? null}
      actions={
        <>
          <button
            className="primary-button"
            data-testid={`decision-submit-${String(props.request.id)}`}
            onClick={() =>
              void props.onResolve({
                requestId: props.request.id,
                kind: "dynamicToolCall",
                resolution: {
                  success: true,
                  contentItems: responseText.trim()
                    ? ([{ type: "inputText", text: responseText.trim() }] satisfies Array<DynamicToolCallOutputContentItem>)
                    : [],
                },
              })
            }
          >
            {t("decisionCenter.submitResult")}
          </button>
          <button
            className="ghost-button"
            onClick={() =>
              void props.onResolve({
                requestId: props.request.id,
                kind: "dynamicToolCall",
                resolution: {
                  success: false,
                  contentItems: [],
                },
              })
            }
          >
            {t("decisionCenter.markFailed")}
          </button>
        </>
      }
    >
      <DecisionJsonBlock label={t("decisionCenter.labels.arguments")} value={params.arguments ?? {}} />
      <label className="decision-form__label">
        <strong>{t("decisionCenter.labels.response")}</strong>
      </label>
      <textarea
        className="workspace-form__input decision-form__textarea"
        value={responseText}
        onChange={(event) => setResponseText(event.target.value)}
      />
    </DecisionCardChrome>
  );
}

function ChatgptAuthTokensRefreshCard(props: {
  request: PendingServerRequest;
  onResolve: (resolution: ServerRequestResolveInput) => Promise<void>;
}) {
  const { t } = useAppLocale();
  const params = asRecord(props.request.params);
  const [accessToken, setAccessToken] = useState("");
  const [accountId, setAccountId] = useState(readString(params.previousAccountId) ?? "");
  const [planType, setPlanType] = useState("");

  return (
    <DecisionCardChrome
      request={props.request}
      title={t("decisionCenter.kinds.chatgptAuthTokensRefresh")}
      actions={
        <button
          className="primary-button"
          data-testid={`decision-submit-${String(props.request.id)}`}
          disabled={!accessToken.trim() || !accountId.trim()}
          onClick={() =>
            void props.onResolve({
              requestId: props.request.id,
              kind: "chatgptAuthTokensRefresh",
              resolution: {
                accessToken: accessToken.trim(),
                chatgptAccountId: accountId.trim(),
                chatgptPlanType: planType.trim() || null,
              },
            })
          }
        >
          {t("decisionCenter.submitTokens")}
        </button>
      }
    >
      {readString(params.reason) ? (
        <DecisionMetaLine label={t("decisionCenter.labels.reason")} value={readString(params.reason) ?? ""} />
      ) : null}
      <label className="decision-form__label">
        <strong>{t("decisionCenter.labels.accessToken")}</strong>
      </label>
      <input
        className="workspace-form__input"
        type="password"
        value={accessToken}
        onChange={(event) => setAccessToken(event.target.value)}
      />
      <label className="decision-form__label">
        <strong>{t("decisionCenter.labels.accountId")}</strong>
      </label>
      <input
        className="workspace-form__input"
        value={accountId}
        onChange={(event) => setAccountId(event.target.value)}
      />
      <label className="decision-form__label">
        <strong>{t("decisionCenter.labels.planType")}</strong>
      </label>
      <input
        className="workspace-form__input"
        value={planType}
        onChange={(event) => setPlanType(event.target.value)}
      />
    </DecisionCardChrome>
  );
}

function ApplyPatchApprovalCard(props: {
  request: PendingServerRequest;
  onResolve: (resolution: ServerRequestResolveInput) => Promise<void>;
}) {
  const { t } = useAppLocale();
  const params = asRecord(props.request.params);
  return (
    <DecisionCardChrome
      request={props.request}
      title={t("decisionCenter.kinds.applyPatchApproval")}
      actions={
        <>
          <button
            className="primary-button"
            data-testid={`decision-accept-${String(props.request.id)}`}
            onClick={() =>
              void props.onResolve(buildDefaultServerRequestResolveInput(props.request, "accept"))
            }
          >
            {t("common.accept")}
          </button>
          <button
            className="ghost-button"
            data-testid={`decision-decline-${String(props.request.id)}`}
            onClick={() =>
              void props.onResolve(buildDefaultServerRequestResolveInput(props.request, "decline"))
            }
          >
            {t("common.decline")}
          </button>
        </>
      }
    >
      {readString(params.reason) ? (
        <DecisionTextBlock label={t("decisionCenter.labels.reason")} value={readString(params.reason) ?? ""} />
      ) : null}
      {params.fileChanges ? (
        <DecisionJsonBlock label={t("decisionCenter.labels.fileChanges")} value={params.fileChanges} />
      ) : null}
    </DecisionCardChrome>
  );
}

function ExecCommandApprovalCard(props: {
  request: PendingServerRequest;
  onResolve: (resolution: ServerRequestResolveInput) => Promise<void>;
}) {
  const { t } = useAppLocale();
  const params = asRecord(props.request.params);
  return (
    <DecisionCardChrome
      request={props.request}
      title={t("decisionCenter.kinds.execCommandApproval")}
      actions={
        <>
          <button
            className="primary-button"
            data-testid={`decision-accept-${String(props.request.id)}`}
            onClick={() =>
              void props.onResolve(buildDefaultServerRequestResolveInput(props.request, "accept"))
            }
          >
            {t("common.accept")}
          </button>
          <button
            className="ghost-button"
            data-testid={`decision-decline-${String(props.request.id)}`}
            onClick={() =>
              void props.onResolve(buildDefaultServerRequestResolveInput(props.request, "decline"))
            }
          >
            {t("common.decline")}
          </button>
        </>
      }
    >
      {Array.isArray(params.command) ? (
        <div className="decision-card__section">
          <span className="decision-card__label">{t("decisionCenter.labels.command")}</span>
          <RenderableCodeBlock
            value={params.command.filter((entry): entry is string => typeof entry === "string").join(" ")}
            language="bash"
          />
        </div>
      ) : null}
      {readString(params.cwd) ? (
        <DecisionMetaLine label={t("decisionCenter.labels.cwd")} value={readString(params.cwd) ?? ""} />
      ) : null}
      {readString(params.reason) ? (
        <DecisionTextBlock label={t("decisionCenter.labels.reason")} value={readString(params.reason) ?? ""} />
      ) : null}
      {params.parsedCmd ? (
        <DecisionJsonBlock label={t("decisionCenter.labels.parsedCommand")} value={params.parsedCmd} />
      ) : null}
    </DecisionCardChrome>
  );
}

function DecisionMetaLine(props: { label: string; value: string }) {
  return (
    <div className="decision-card__section">
      <span className="decision-card__label">{props.label}</span>
      <span className="decision-card__inline-value">{props.value}</span>
    </div>
  );
}

function DecisionTextBlock(props: { label: string; value: string }) {
  return (
    <div className="decision-card__section">
      <span className="decision-card__label">{props.label}</span>
      <RenderableMarkdown text={props.value} compact />
    </div>
  );
}

function DecisionJsonBlock(props: { label: string; value: unknown }) {
  return (
    <div className="decision-card__section">
      <span className="decision-card__label">{props.label}</span>
      <RenderableCodeBlock value={safeJson(props.value)} language="json" />
    </div>
  );
}

function McpElicitationForm(props: {
  params: Record<string, unknown>;
  formState: Record<string, JsonValue>;
  onChange: (next: Record<string, JsonValue>) => void;
}) {
  const { t } = useAppLocale();
  const schema = asRecord(props.params.requestedSchema);
  const properties = asRecord(schema.properties);

  return (
    <div className="decision-form">
      {Object.entries(properties).map(([key, rawSchema]) => {
        const fieldSchema = asRecord(rawSchema);
        const label = readString(fieldSchema.title) ?? key;
        const description = readString(fieldSchema.description);
        const enumOptions = readEnumOptions(fieldSchema);
        if (enumOptions.length > 0) {
          const currentValue = props.formState[key];
          const isMulti = fieldSchema.type === "array";
          return (
            <div key={key} className="decision-form__field">
              <label className="decision-form__label">
                <strong>{label}</strong>
                {description ? <span>{description}</span> : null}
              </label>
              {isMulti ? (
                <select
                  className="workspace-form__input"
                  multiple
                  value={Array.isArray(currentValue) ? currentValue.map(String) : []}
                  onChange={(event) =>
                    props.onChange({
                      ...props.formState,
                      [key]: Array.from(event.target.selectedOptions).map((option) => option.value),
                    })
                  }
                >
                  {enumOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : (
                <select
                  className="workspace-form__input"
                  value={typeof currentValue === "string" ? currentValue : ""}
                  onChange={(event) =>
                    props.onChange({
                      ...props.formState,
                      [key]: event.target.value,
                    })
                  }
                >
                  <option value="">{t("decisionCenter.selectPlaceholder")}</option>
                  {enumOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              )}
            </div>
          );
        }

        if (fieldSchema.type === "boolean") {
          return (
            <label key={key} className="decision-form__checkbox">
              <input
                type="checkbox"
                checked={Boolean(props.formState[key])}
                onChange={(event) =>
                  props.onChange({
                    ...props.formState,
                    [key]: event.target.checked,
                  })
                }
              />
              <span>
                <strong>{label}</strong>
                {description ? <span>{description}</span> : null}
              </span>
            </label>
          );
        }

        const numeric = fieldSchema.type === "integer" || fieldSchema.type === "number";
        const currentValue = props.formState[key];
        return (
          <div key={key} className="decision-form__field">
            <label className="decision-form__label">
              <strong>{label}</strong>
              {description ? <span>{description}</span> : null}
            </label>
            <input
              className="workspace-form__input"
              type={numeric ? "number" : "text"}
              value={typeof currentValue === "number" ? String(currentValue) : typeof currentValue === "string" ? currentValue : ""}
              onChange={(event) =>
                props.onChange({
                  ...props.formState,
                  [key]: numeric
                    ? event.target.value === ""
                      ? 0
                      : Number(event.target.value)
                    : event.target.value,
                })
              }
            />
          </div>
        );
      })}
    </div>
  );
}

type UserInputQuestion = {
  id: string;
  header: string;
  question: string;
  isOther: boolean;
  isSecret: boolean;
  options: Array<{ label: string; description: string }> | null;
};

function readQuestions(params: Record<string, unknown>): Array<UserInputQuestion> {
  const questions = Array.isArray(asRecord(params).questions) ? (asRecord(params).questions as Array<unknown>) : [];
  return questions
    .map((entry) => {
      const record = asRecord(entry);
      const id = readString(record.id);
      const header = readString(record.header);
      const question = readString(record.question);
      if (!id || !header || !question) {
        return null;
      }
      return {
        id,
        header,
        question,
        isOther: Boolean(record.isOther),
        isSecret: Boolean(record.isSecret),
        options: Array.isArray(record.options)
          ? record.options
              .map((option) => {
                const item = asRecord(option);
                const label = readString(item.label);
                if (!label) {
                  return null;
                }
                return {
                  label,
                  description: readString(item.description) ?? "",
                };
              })
              .filter((option): option is { label: string; description: string } => option !== null)
          : null,
      } satisfies UserInputQuestion;
    })
    .filter((entry): entry is UserInputQuestion => entry !== null);
}

function buildInitialElicitationFormState(params: Record<string, unknown>): Record<string, JsonValue> {
  const schema = asRecord(params.requestedSchema);
  const properties = asRecord(schema.properties);
  const next: Record<string, JsonValue> = {};
  for (const [key, rawSchema] of Object.entries(properties)) {
    const fieldSchema = asRecord(rawSchema);
    if ("default" in fieldSchema) {
      next[key] = (fieldSchema.default as JsonValue | undefined) ?? "";
      continue;
    }
    const enumOptions = readEnumOptions(fieldSchema);
    if (enumOptions.length > 0) {
      next[key] = fieldSchema.type === "array" ? [] : "";
      continue;
    }
    if (fieldSchema.type === "boolean") {
      next[key] = false;
    } else if (fieldSchema.type === "number" || fieldSchema.type === "integer") {
      next[key] = 0;
    } else {
      next[key] = "";
    }
  }
  return next;
}

function readEnumOptions(schema: Record<string, unknown>): Array<{ value: string; label: string }> {
  if (Array.isArray(schema.enum)) {
    return schema.enum
      .filter((value): value is string => typeof value === "string")
      .map((value, index) => ({
        value,
        label:
          Array.isArray(schema.enumNames) && typeof schema.enumNames[index] === "string"
            ? (schema.enumNames[index] as string)
            : value,
      }));
  }

  if (Array.isArray(schema.oneOf)) {
    return schema.oneOf
      .map((option) => {
        const record = asRecord(option);
        const value = readString(record.const);
        if (!value) {
          return null;
        }
        return {
          value,
          label: readString(record.title) ?? value,
        };
      })
      .filter((entry): entry is { value: string; label: string } => entry !== null);
  }

  const items = asRecord(schema.items);
  if (Array.isArray(items.enum)) {
    return items.enum
      .filter((value): value is string => typeof value === "string")
      .map((value, index) => ({
        value,
        label:
          Array.isArray(items.enumNames) && typeof items.enumNames[index] === "string"
            ? (items.enumNames[index] as string)
            : value,
      }));
  }

  if (Array.isArray(items.oneOf)) {
    return items.oneOf
      .map((option) => {
        const record = asRecord(option);
        const value = readString(record.const);
        if (!value) {
          return null;
        }
        return {
          value,
          label: readString(record.title) ?? value,
        };
      })
      .filter((entry): entry is { value: string; label: string } => entry !== null);
  }

  return [];
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
