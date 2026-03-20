# Wave1 Release Checklist

Use this checklist after `main` CI and the automatic staging deploy both succeed. The goal is to confirm that WebCLI behaves like a remote single-user Codex Desktop client for the first-wave capability surface.

## Preconditions

- `main` CI is green:
  - `build`
  - `typecheck`
  - `test`
  - `e2e`
- `Deploy Staging` completed successfully for the same `main` commit.
- Staging endpoints are healthy:
  - [staging.webcli.royding.ai](https://staging.webcli.royding.ai)
  - [api.staging.webcli.royding.ai/api/health](https://api.staging.webcli.royding.ai/api/health)

## Capability Checks

### Thread lifecycle and history

- Open a real thread from the sidebar thread tree.
- Confirm the thread tree is visible and thread switching still works.
- Confirm the active thread header shows the conversation summary when available.
- Open Settings -> `历史` and confirm archived threads are still reachable.

### Decision flows

- Trigger a server request that lands in the Decision Center.
- Confirm the pending card renders with the correct decision UI.
- Submit a resolution and confirm the pending card clears.

### Review, git, and file preview

- Open Git Review from the current thread context.
- Confirm the review tree loads and file selection updates the right pane.
- Open `Remote diff` and confirm the remote-vs-working-tree diff renders.
- Open a `/srv/...` code link and confirm it opens the preview modal instead of a plain external link.

### Plugins, skills, apps, and MCP

- Open Settings -> `集成` and confirm MCP server status is visible.
- Open Settings -> `扩展` and confirm the page shows:
  - skills
  - remote skills
  - apps
  - plugins

### Account, config, warnings, and reroute

- Open Settings -> `账号` and confirm:
  - detailed rate limits
  - external agent config import
  - warnings / deprecations / model reroute
- Open Settings -> `默认代理` and confirm config requirements and default agent config are present.

### Conversation experience

- Send a real prompt.
- Confirm streaming output grows continuously without disappearing and reappearing.
- Confirm plan cards, queued prompts, and current rich timeline items still render normally.

## Console Sanity

- During the checks above, confirm the browser console has no new runtime errors.
- Pay specific attention to regressions around:
  - Monaco dispose errors
  - code preview open/close
  - review open/close
  - streaming timeline updates

## Exit Criteria

- Every section above passes on staging for the same deployed `main` commit.
- No new console errors appear.
- The parity matrix still reports wave1 with no `missing` entries.
- Only explicit wave2 capabilities remain in `deferred-wave2`.
