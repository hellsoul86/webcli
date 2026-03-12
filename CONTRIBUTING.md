# Contributing

## Workflow

`main` is the only long-lived development branch. Keep it releasable at all times.

All changes should:

- branch from the latest `main`
- use a short-lived branch named `feature/*`, `fix/*`, or `chore/*`
- merge back through a pull request
- use squash merge to keep `main` linear

Direct pushes to `main` are not part of the normal workflow.

## Pull Requests

Each pull request should explain:

- the problem being solved
- the chosen implementation
- validation that was run locally
- any user-facing or operational risk

Before opening a pull request, run:

```bash
npm run build
npm run typecheck
npm run test
npm run e2e
```

If a check is intentionally skipped, call that out in the PR body.

## Releases

Stable baselines are captured with Git tags and GitHub Releases, not by freezing `main`.

- Use `vX.Y.Z` tags for releases.
- Create a GitHub Release for each published baseline.
- Treat the release tag as the source of truth for historical baselines.

## Hotfixes

Do not keep a permanent `develop` branch or a permanent `release/*` branch.

If an old release needs a patch:

- create a temporary `release/vX.Y.x` branch from the corresponding tag
- apply the fix
- cut a new patch tag
- merge or cherry-pick the fix back to `main`

## Legacy Branches

Historical baseline branches can remain as references during the transition, but new work should not branch from them. Once the tag-and-release flow is established, archive or remove those legacy branches.
