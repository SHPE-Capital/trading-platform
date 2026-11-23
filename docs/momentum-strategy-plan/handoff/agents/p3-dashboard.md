# Agent brief: dashboard (P3)

Suggested agent: `feature-implementer` with the frontend skills. Owner: Person 1. Repo: **trading-platform**, frontend and API.
Full packets: [../../momentum-tasks-P3-dashboard.md](../../momentum-tasks-P3-dashboard.md).

Follow the shared rules in [../README.md](../README.md): one task, one branch, one worktree (`<name>/MO-<ID>`); exclusive Owns lists; stage your own files by path (no `git stash`, no `git add -A`); every tunable comes from the protocol config (0-G); never claim a check passed without seeing it run. End with: what changed (files), verification and results, unresolved risks.

## Goal
Show the momentum strategy's live state and research results in the club dashboard.

## Tasks, in order
1. **P3-2 momentum live page** on mock data now (`frontend/app/momentum/`, `frontend/features/momentum/`).
2. **P3-1 backend API** (`backend/src/app/routes/momentum.ts`): status and weekly artifacts. Needs 0-A; decide with P1-2 where artifacts are stored.
3. **P3-3 research results view** (`frontend/features/momentum/results/`) from the E2 JSON summary (mock it from the schema now).

## Do not
Change API or WebSocket contracts without checking their callers and `frontend/types`. Read the installed Next.js docs first (`frontend/AGENTS.md`).

## Verify
`npm --prefix frontend run lint`, `run test`, `run build`; backend typecheck, lint and focused Jest for P3-1.
