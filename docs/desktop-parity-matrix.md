# Desktop Parity Matrix

This matrix is the source of truth for how WebCLI maps `codex app-server` capabilities into the Web workbench.

- Generated request source: `packages/runtime-codex/src/generated/ClientRequest.ts`
- Generated notification source: `packages/runtime-codex/src/generated/ServerNotification.ts`
- Machine-readable matrix: [./desktop-parity-matrix.json](./desktop-parity-matrix.json)

Status meanings:

- `supported`: available today without a capability gap
- `partial`: available through a renamed, aggregated, or reduced WebCLI surface
- `missing`: in wave 1 scope, but not yet surfaced
- `deferred-wave2`: intentionally postponed to wave 2

This file is intentionally short. CI validates that every generated request and notification appears in the JSON matrix exactly once.
