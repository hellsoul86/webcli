import type { ReactNode } from "react";

type WorkbenchOverlaysProps = {
  workspaceModal: ReactNode;
  codePreview: ReactNode;
  imagePreview: ReactNode;
  settingsOverlay: ReactNode;
  commandPalette: ReactNode;
  blockingOverlay: ReactNode;
  errorMessage: string | null;
};

export function WorkbenchOverlays(props: WorkbenchOverlaysProps) {
  return (
    <>
      {props.workspaceModal}
      {props.codePreview}
      {props.imagePreview}
      {props.settingsOverlay}
      {props.commandPalette}
      {props.blockingOverlay}
      {props.errorMessage ? (
        <div
          style={{
            position: "fixed",
            right: 18,
            bottom: 14,
            display: "grid",
            gap: 4,
            justifyItems: "end",
            zIndex: 35,
          }}
        >
          <span style={{ color: "#f06d65", fontSize: "0.85rem" }}>{props.errorMessage}</span>
        </div>
      ) : null}
    </>
  );
}
