# Workflow Standards

## Branching
- Treat `main` as the clean integration branch.
- Do not implement feature work, refactors, or fixes directly on `main`.
- Every non-trivial task must use its own short-lived task branch.
- Task branches should follow the `codex/<task-slug>` naming convention.

## Isolation
- Each task branch must be developed in its own linked git worktree.
- Do not mix unrelated tasks in the same checkout or the same worktree.
- If work resumes on an existing task, reuse the existing task branch and worktree instead of creating a parallel copy.

## Sync
- Start task branches from the latest `main`.
- Keep task branches current by rebasing onto `origin/main`.
- Do not merge `main` into task branches.

## Pull Requests
- Push work to the task branch only. Do not push feature work directly to `main`.
- After the first push, the branch should move through a pull request, starting in draft state.
- A pull request should be marked ready only after the required local and CI verification has been completed, or any skipped checks have been explicitly explained.
- The normal path into `main` is a squash-merged pull request.

## Cleanup
- After a task branch has been merged, delete the local worktree and delete the local task branch.
- The remote task branch is expected to be removed after merge as part of the normal cleanup flow.

## Exceptions
- Any bypass of this workflow, including urgent one-off work on `main`, requires explicit user confirmation first.
