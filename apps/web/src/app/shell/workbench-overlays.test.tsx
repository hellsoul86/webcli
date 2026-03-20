import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WorkbenchOverlays } from "./workbench-overlays";

describe("WorkbenchOverlays", () => {
  it("renders every overlay slot and the shared error toast host", () => {
    render(
      <WorkbenchOverlays
        workspaceModal={<div data-testid="workspace-modal-slot" />}
        codePreview={<div data-testid="code-preview-slot" />}
        imagePreview={<div data-testid="image-preview-slot" />}
        settingsOverlay={<div data-testid="settings-overlay-slot" />}
        commandPalette={<div data-testid="command-palette-slot" />}
        blockingOverlay={<div data-testid="blocking-overlay-slot" />}
        errorMessage="Something went wrong"
      />,
    );

    expect(screen.getByTestId("workspace-modal-slot")).toBeVisible();
    expect(screen.getByTestId("code-preview-slot")).toBeVisible();
    expect(screen.getByTestId("image-preview-slot")).toBeVisible();
    expect(screen.getByTestId("settings-overlay-slot")).toBeVisible();
    expect(screen.getByTestId("command-palette-slot")).toBeVisible();
    expect(screen.getByTestId("blocking-overlay-slot")).toBeVisible();
    expect(screen.getByText("Something went wrong")).toBeVisible();
  });
});
