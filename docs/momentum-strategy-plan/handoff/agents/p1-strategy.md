# Agent brief: platform strategy (P1)

Suggested agent: `feature-implementer` (isolated worktree). Owner: Person 1. Repo: **trading-platform**, backend.
Full packets: [../../momentum-tasks-P1-platform-strategy.md](../../momentum-tasks-P1-platform-strategy.md).

Follow the shared rules in [../README.md](../README.md): one task, one branch, one worktree (`<name>/MO-<ID>`); exclusive Owns lists; stage your own files by path (no `git stash`, no `git add -A`); every tunable comes from the protocol config (0-G); never claim a check passed without seeing it run. End with: what changed (files), verification and results, unresolved risks.

## Goal
Port the research reference (stream B plus the C3/C4 allocation rules) to TypeScript so the paper strategy runs in the platform engine. Live logic cannot call external services, so it must match Python output on the golden fixtures.

## Tasks, in order
1. **P1-1 indicators** in `backend/src/services/indicators/` (`atr.ts`, `adx.ts`, `rollingHigh.ts`, `clockRelativeVolume.ts`, `sessionVwap.ts`) with hand-worked tests. Can split into two agents: (ATR, ADX) and (rolling high, RVOL, VWAP). Must match the B1 to B3 incremental forms.
2. **P1-2 weekly config loader** (`strategies/momentum/weeklyConfig*.ts`). Needs 0-A and 0-B. A missing, stale, invalid or unknown-version artifact disables new entries; open positions keep protection; switch configs only while flat.
3. **P1-3 `BreakoutMomentumStrategy`** and manifest. Catalog registration is **Coordinate** (`config/strategyCatalog.ts`).
4. **P1-4 minute batch and allocator**, **P1-5 funded-account sizer**. **Coordinate** with the `core/engine/orchestrator.ts` and `core/oms/` owners.
5. **P1-6 golden parity test.** Needs B6 golden files from Person 2.

## Inputs you wait for
0-A schema, 0-B grid and config ID, 0-D golden format, B6 fixtures. Until then use hand calculations.

## Do not
Start the paper or real runtime, run migrations, change event-dispatch order, or edit files owned by P2 or P3.

## Verify
`npm --prefix backend run typecheck`, `npm --prefix backend run lint`, `npm --prefix backend test -- --runInBand <path>`.
