import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExperimentalFeatureSnapshot } from "@webcli/contracts";
import { setAppLocale } from "../../i18n/init";
import { ExperimentalFeaturesSection } from "./experimental-features-section";

const features: Array<ExperimentalFeatureSnapshot> = [
  {
    name: "apps",
    stage: "stable",
    displayName: "Apps",
    description: "Enable app discovery.",
    announcement: null,
    enabled: true,
    defaultEnabled: true,
  },
  {
    name: "multi_agent",
    stage: "beta",
    displayName: "Multi-agent mode",
    description: "Use multiple agents on suitable tasks.",
    announcement: "Recommended for large repository work.",
    enabled: false,
    defaultEnabled: false,
  },
];

describe("ExperimentalFeaturesSection", () => {
  beforeEach(async () => {
    await setAppLocale("en-US");
  });

  it("renders features in stage order and fires toggle actions", () => {
    const onToggle = vi.fn();

    render(
      <ExperimentalFeaturesSection
        features={features}
        loading={false}
        error={null}
        pendingNames={[]}
        onToggle={onToggle}
      />,
    );

    const rows = screen.getAllByTestId(/settings-experimental-feature-(multi-agent|apps)$/);
    expect(rows[0]).toHaveTextContent("Multi-agent mode");
    expect(rows[1]).toHaveTextContent("Apps");
    expect(screen.getByTestId("settings-experimental-feature-announcement-multi-agent")).toHaveTextContent(
      "Recommended for large repository work.",
    );

    fireEvent.click(screen.getByTestId("settings-experimental-feature-toggle-multi-agent"));
    expect(onToggle).toHaveBeenCalledWith(features[1]);
  });

  it("renders loading, empty, and error states", () => {
    const { rerender } = render(
      <ExperimentalFeaturesSection
        features={[]}
        loading
        error={null}
        pendingNames={[]}
        onToggle={() => {}}
      />,
    );

    expect(screen.getByTestId("settings-experimental-features-loading")).toHaveTextContent(
      "Loading experimental features",
    );

    rerender(
      <ExperimentalFeaturesSection
        features={[]}
        loading={false}
        error={"Request failed"}
        pendingNames={[]}
        onToggle={() => {}}
      />,
    );

    expect(screen.getByTestId("settings-experimental-features-error")).toHaveTextContent(
      "Request failed",
    );

    rerender(
      <ExperimentalFeaturesSection
        features={[]}
        loading={false}
        error={null}
        pendingNames={[]}
        onToggle={() => {}}
      />,
    );

    expect(screen.getByTestId("settings-experimental-features-empty")).toHaveTextContent(
      "No experimental features available",
    );
  });
});
