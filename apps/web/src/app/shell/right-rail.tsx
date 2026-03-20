import type { PendingServerRequest, ServerRequestResolveInput } from "@webcli/contracts";
import { DecisionCenter } from "./decision-center";

type RightRailProps = {
  requests: Array<PendingServerRequest>;
  onResolve: (resolution: ServerRequestResolveInput) => Promise<void>;
};

export function RightRail(props: RightRailProps) {
  return <DecisionCenter requests={props.requests} onResolve={props.onResolve} />;
}
