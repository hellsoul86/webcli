# WebCLI

Remote single-user Codex workbench built on top of `codex app-server`. Provides a browser-based UI for interacting with OpenAI Codex sessions over WebSocket.

## Apps

| App | Package | Port | Role |
|---|---|---|---|
| `apps/server` | `@webcli/server` | 4000 | Fastify API + WebSocket relay to Codex runtime |
| `apps/web` | `@webcli/web` | 5173 | Vite + React SPA (Zustand store, i18n, Monaco) |

## Shared Packages

| Package | Used By | Purpose |
|---|---|---|
| `packages/contracts` | server, web | Domain types, HTTP contract, WebSocket protocol |
| `packages/core` | server | Session manager, workspace repo, command service |
| `packages/runtime-codex` | server, core | Generated Codex runtime type bindings |

## Commands

```bash
npm install               # install all dependencies
npm run dev               # concurrently run server + web in dev mode
npm run build             # build all workspaces
npm run typecheck         # tsc --noEmit across all workspaces
npm run test              # repo-level + workspace unit tests
npm run e2e               # playwright end-to-end tests
npm run verify            # build + typecheck + test + e2e (full gate)
```

## Tech Stack

- TypeScript (strict), Node.js >= 25
- npm workspaces (not pnpm)
- Fastify + WebSocket (`@fastify/websocket`)
- React 19, Vite 6, Zustand 5
- Monaco Editor, react-markdown, i18next
- Vitest for unit tests, Playwright for e2e
- ESM only (`"type": "module"`)

## Conventions

- ESM only across all packages
- `import type` for type-only imports
- Workspace dependencies use `file:` protocol
- Zero test failures enforced
- Metadata stored in SQLite (`apps/server/data/webcli.sqlite`)
- Thread history owned by Codex rollout storage; this app indexes and projects it

## Git Workflow

- `main` is the integration branch. Never commit directly to `main`.
- Task branches: `codex/<slug>` (agent) or `feat|fix|chore/<slug>` (human).
- Start task branches from latest `origin/main`. Rebase, never merge main into task branches.
- Each task branch should use its own git worktree for isolation.
- Create draft PR after first push. Continue updating the same branch/PR until complete.
- If CI fails, fix on the same branch — do not create a new PR.

## Delivery Flow

When delivering a code change, execute the full pipeline as one continuous flow:

1. **Branch** — `git checkout -b <type>/<slug> origin/main`
2. **Develop** — implement, then verify: `npm run verify`
3. **Commit** — message format: `<type>: <what and why>`
4. **Push** — `git push -u origin <branch>`
5. **PR** — `gh pr create --title "<title>" --body "..."` (draft first if CI not yet green)
6. **CI** — wait for all checks to pass: `gh pr checks <pr-number>`
7. **Merge** — `gh pr merge <pr-number> --squash --delete-branch`

Do not stop between steps to ask "what next?" — the flow is well-defined.

### Commit Message Format

```
<type>: <what and why>
```

Types: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`

### PR Body Template

```markdown
Closes #<issue-number>

## Summary
What changed and why?

## Validation
- [ ] `npm run verify` passed (build + typecheck + test + e2e)
```

## CI / CD Workflows

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `ci.yml` | PR, push to main | build + typecheck + test + e2e |
| `deploy-staging.yml` | push to main, manual | Deploy to staging |

## Environment

- **local**: `npm run dev` (server 4000, web 5173)
- **staging**: Alibaba Cloud + Nginx + Cloudflare (`staging.webcli.royding.ai`)
- **prod**: not activated

Deploy config: `deploy/staging/`

## Autonomy Defaults

Allowed without asking:
- `git fetch`, create/reuse task branches, rebase, run verification, push task branches
- Create/update draft PRs, merge ready PRs, remove branches after confirmed merge
- Deploy to staging via workflow dispatch

Not allowed without asking:
- Work directly on `main`, force push, destructive git commands
- Create tags/releases unless explicitly asked
- Deploy to production
