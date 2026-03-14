# Contributing

This document is the operational companion to [AGENTS.md](./AGENTS.md).

- `AGENTS.md` defines the workflow standards and constraints.
- `CONTRIBUTING.md` explains the concrete steps and commands maintainers should use.

## Task Lifecycle

All non-trivial work follows the same path:

1. Start from a clean primary checkout on `main`
2. Create or reuse a task branch and linked worktree
3. Implement inside that worktree
4. Rebase the task branch onto `origin/main` as needed
5. Run the required local verification
6. Push the branch and open a draft pull request
7. Move the PR to ready only after verification is complete
8. Squash merge into `main`
9. Clean up the local worktree and local task branch

## Starting a Task

The primary checkout should stay on `main` and stay clean.

From the repository root:

```bash
npm run task:start -- <task-slug>
```

Defaults for this repository:

- task branch name: `codex/<task-slug>`
- worktree location: `../.codex/worktrees/webcli-<task-slug>`

The script will create the branch/worktree if needed, or reuse the existing task worktree when the task already exists.

## Working in a Task Worktree

Do all code changes inside the linked worktree for the task.

When `main` has moved forward, sync the task branch with:

```bash
npm run task:sync
```

This flow is intentionally rebase-only:

- use `rebase origin/main`
- do not merge `main` into the task branch
- do not do unrelated work in the same worktree

## Local Verification

During iteration you can run targeted checks, but before marking a PR ready you should run the full local gate:

```bash
npm run verify
```

That runs:

```bash
npm run build
npm run typecheck
npm run test
npm run e2e
```

These checks are aligned with the required GitHub checks on `main`.

## Repository Notes

- This repository is a Node.js 25 npm-workspaces monorepo spanning the Fastify server, the Vite web app, and the shared/runtime packages.
- Live runtime flows depend on `codex` being installed on the host and already authenticated with `codex login`.
- Treat `apps/server/data/webcli.sqlite` as local state. It should not be treated as a committed artifact.

Useful repo-specific commands:

```bash
npm run dev
npm run task:start -- <task-slug>
npm run task:sync
npm run task:finish -- <task-slug>
```

- `npm run dev` starts the web app at `http://127.0.0.1:5173` and the API/WebSocket server at `http://127.0.0.1:4000`.
- `npm run task:start`, `npm run task:sync`, and `npm run task:finish` are the standard task workflow helpers for this repository.

## Pull Requests

After the first push, open a draft PR:

```bash
gh pr create --draft --fill
```

PR expectations:

- branch work only; never direct-push feature work to `main`
- draft first, ready later
- use the PR template
- explain any skipped validation explicitly

The repository is configured around this merge policy:

- branch protection on `main`
- required checks for build, typecheck, test, and e2e
- squash merge only
- automatic remote branch deletion after merge

## Cleaning Up After Merge

Once the PR has been merged into `main`, return to the clean primary checkout and run:

```bash
npm run task:finish -- <task-slug>
```

This removes the local worktree and deletes the local `codex/<task-slug>` branch.

## Hotfixes

Urgent fixes still use the same flow unless there is an explicit exception:

- create `codex/hotfix-<task-slug>`
- work in a linked worktree
- verify locally
- open a PR
- squash merge back to `main`

## Out of Scope

This document covers day-to-day development workflow only.

- Release tagging
- versioning policy
- deploy/release automation

Those can be documented separately if needed.
