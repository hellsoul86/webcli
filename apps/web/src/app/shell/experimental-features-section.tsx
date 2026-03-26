import type { ExperimentalFeatureSnapshot } from "@webcli/contracts";
import { useMemo } from "react";
import { useAppLocale } from "../../i18n/use-i18n";

const STAGE_ORDER: Record<ExperimentalFeatureSnapshot["stage"], number> = {
  beta: 0,
  underDevelopment: 1,
  stable: 2,
  deprecated: 3,
  removed: 4,
};

function getFeatureLabel(feature: ExperimentalFeatureSnapshot): string {
  return feature.displayName?.trim() || feature.name;
}

function getStageBadgeClass(stage: ExperimentalFeatureSnapshot["stage"]): string {
  switch (stage) {
    case "stable":
      return "status-pill status-pill--green";
    case "beta":
      return "status-pill status-pill--amber";
    default:
      return "status-pill status-pill--slate";
  }
}

function getStageLabel(
  stage: ExperimentalFeatureSnapshot["stage"],
  t: ReturnType<typeof useAppLocale>["t"],
): string {
  return t(`settings.experimentalFeaturesStages.${stage}`);
}

function sanitizeFeatureTestId(name: string): string {
  return name.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

export function ExperimentalFeaturesSection(props: {
  features: Array<ExperimentalFeatureSnapshot>;
  loading: boolean;
  error: string | null;
  pendingNames: Array<string>;
  onToggle: (feature: ExperimentalFeatureSnapshot) => void;
}) {
  const { t } = useAppLocale();
  const sortedFeatures = useMemo(
    () =>
      [...props.features].sort((left, right) => {
        const stageDelta = STAGE_ORDER[left.stage] - STAGE_ORDER[right.stage];
        if (stageDelta !== 0) {
          return stageDelta;
        }
        return getFeatureLabel(left).localeCompare(getFeatureLabel(right), undefined, {
          sensitivity: "base",
        });
      }),
    [props.features],
  );

  if (props.loading) {
    return (
      <div
        className="settings-empty-inline"
        data-testid="settings-experimental-features-loading"
      >
        {t("settings.experimentalFeaturesLoading")}
      </div>
    );
  }

  if (props.error) {
    return (
      <div
        className="settings-empty-inline"
        data-testid="settings-experimental-features-error"
      >
        {props.error}
      </div>
    );
  }

  if (sortedFeatures.length === 0) {
    return (
      <div
        className="settings-empty-inline"
        data-testid="settings-experimental-features-empty"
      >
        {t("settings.experimentalFeaturesEmpty")}
      </div>
    );
  }

  return (
    <div className="settings-section" data-testid="settings-experimental-features">
      {sortedFeatures.map((feature) => {
        const label = getFeatureLabel(feature);
        const testIdSuffix = sanitizeFeatureTestId(feature.name);
        const pending = props.pendingNames.includes(feature.name);

        return (
          <div
            key={feature.name}
            className="plugin-row experimental-feature-row"
            data-testid={`settings-experimental-feature-${testIdSuffix}`}
          >
            <div className="experimental-feature-row__body">
              <div className="experimental-feature-row__header">
                <strong>{label}</strong>
                <span className={getStageBadgeClass(feature.stage)}>
                  {getStageLabel(feature.stage, t)}
                </span>
              </div>
              <p className="muted">
                {feature.description ?? t("settings.experimentalFeaturesNoDescription")}
              </p>
              <div className="experimental-feature-row__meta">
                <span>
                  {feature.enabled
                    ? t("settings.experimentalFeaturesEnabled")
                    : t("settings.experimentalFeaturesDisabled")}
                </span>
                <span>
                  {feature.defaultEnabled
                    ? t("settings.experimentalFeaturesDefaultOn")
                    : t("settings.experimentalFeaturesDefaultOff")}
                </span>
              </div>
              {feature.announcement ? (
                <p
                  className="experimental-feature-row__announcement"
                  data-testid={`settings-experimental-feature-announcement-${testIdSuffix}`}
                >
                  {feature.announcement}
                </p>
              ) : null}
            </div>

            <button
              type="button"
              className={[
                "experimental-feature-toggle",
                feature.enabled ? "experimental-feature-toggle--enabled" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              data-testid={`settings-experimental-feature-toggle-${testIdSuffix}`}
              role="switch"
              aria-checked={feature.enabled ? "true" : "false"}
              aria-label={label}
              disabled={pending}
              onClick={() => props.onToggle(feature)}
            >
              <span className="experimental-feature-toggle__track" aria-hidden="true">
                <span className="experimental-feature-toggle__thumb" />
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
