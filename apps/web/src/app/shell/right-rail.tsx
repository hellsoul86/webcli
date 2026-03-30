import type { ReactNode } from "react";
import type { PendingServerRequest, ServerRequestResolveInput } from "@webcli/contracts";
import { DecisionCenter } from "./decision-center";

type RightRailProps = {
  requests: Array<PendingServerRequest>;
  onResolve: (resolution: ServerRequestResolveInput) => Promise<void>;
  commandPanel: ReactNode;
};

export function RightRail(props: RightRailProps) {
  return (
    <>
      {props.commandPanel}
      <DecisionCenter requests={props.requests} onResolve={props.onResolve} />
    </>
  );
}
