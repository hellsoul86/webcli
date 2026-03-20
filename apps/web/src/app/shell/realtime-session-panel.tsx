import { memo } from "react";
import { useAppLocale } from "../../i18n/use-i18n";
import type { RealtimeSessionState } from "../../store/workbench-store";

type RealtimeSessionPanelProps = {
  session: RealtimeSessionState;
};

export const RealtimeSessionPanel = memo(function RealtimeSessionPanel(
  props: RealtimeSessionPanelProps,
) {
  const { t } = useAppLocale();
  const statusLabel = getRealtimeStatusLabel(props.session.status, t);

  return (
    <section className="realtime-session" data-testid="realtime-session-panel">
      <div className="realtime-session__header">
        <div>
          <span className="realtime-session__eyebrow">{t("realtime.title")}</span>
          <strong>{statusLabel}</strong>
        </div>
        <span
          className={`realtime-session__status realtime-session__status--${props.session.status}`}
          data-testid="realtime-session-status"
        >
          {statusLabel}
        </span>
      </div>

      {props.session.errorMessage ? (
        <p className="realtime-session__message" data-testid="realtime-session-error">
          {props.session.errorMessage}
        </p>
      ) : null}

      {props.session.closeReason ? (
        <p className="realtime-session__message" data-testid="realtime-session-close-reason">
          {t("realtime.closedReason", { reason: props.session.closeReason })}
        </p>
      ) : null}

      <div className="realtime-session__body">
        <div className="realtime-session__transcript">
          <div className="realtime-session__section-title">{t("realtime.transcript")}</div>
          <div className="realtime-session__list" data-testid="realtime-transcript">
            {props.session.items.length === 0 ? (
              <p className="realtime-session__empty">{t("realtime.empty")}</p>
            ) : (
              props.session.items.map((item) => (
                <article
                  key={item.id}
                  className="realtime-session__item"
                  data-testid={`realtime-item-${item.id}`}
                >
                  <span className="realtime-session__kind">{item.kindLabel}</span>
                  {item.textPreview ? (
                    <p className="realtime-session__text">{item.textPreview}</p>
                  ) : (
                    <pre className="realtime-session__json">{item.jsonPreview}</pre>
                  )}
                </article>
              ))
            )}
          </div>
        </div>

        <div className="realtime-session__audio">
          <div className="realtime-session__section-title">{t("realtime.audio")}</div>
          <div className="realtime-session__audio-meta">
            <span>{t("realtime.audioChunks", { count: props.session.audio.chunkCount })}</span>
            {props.session.audio.sampleRate ? (
              <span>{t("realtime.audioRate", { rate: props.session.audio.sampleRate })}</span>
            ) : null}
          </div>
          {props.session.audio.decodeError ? (
            <p className="realtime-session__audio-error" data-testid="realtime-audio-error">
              {t("realtime.audioError", { error: props.session.audio.decodeError })}
            </p>
          ) : props.session.audio.objectUrl ? (
            <audio
              controls
              preload="metadata"
              src={props.session.audio.objectUrl}
              data-testid="realtime-audio-player"
            />
          ) : (
            <p className="realtime-session__empty">{t("realtime.audioWaiting")}</p>
          )}
        </div>
      </div>
    </section>
  );
});

function getRealtimeStatusLabel(
  status: RealtimeSessionState["status"],
  t: ReturnType<typeof useAppLocale>["t"],
): string {
  switch (status) {
    case "live":
      return t("realtime.status.live");
    case "error":
      return t("realtime.status.error");
    case "closed":
      return t("realtime.status.closed");
  }
}
