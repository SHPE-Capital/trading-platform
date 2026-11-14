# Intraday Momentum: parallel task board

Source: *Intraday Momentum Research and Implementation Guide*, design version 3
(presentation deadline **November 30 2026**). Section numbers (§) below refer to
that guide.

This board splits the remaining work into **workstreams** that different team
members can own at the same time. Each stream has its own file with task
packets (owned files, dependencies, "done when"). The streams only touch each
other through the **Wave 0 contracts**, so once those exist, almost everything
can run in parallel against synthetic fixture data
(`shpe_research.data.fixtures.synthetic_bars`) and stubs.

## Where we are (2026-11-13)

Already built and reusable: Alpaca bar/quote/trade download and Parquet store,
trading calendar, audit, split detection, liquidity × volatility universe
builder, point-in-time security master, cost model (T5), sizing rules (T2),
platform-matching risk checks (T4), paired block bootstrap (E2), and the
per-trade simulator with trailing stops on the **unmerged** `juancavallin/T1`
branch. On the platform: Alpaca adapter, OMS queue and capital reservation,
quote fill model, paper runtime, strategy manifests.

Not started: the five-component breakout strategy, the funded account
simulator, weighting policies, search/surrogate, the weekly walk-forward loop,
the platform momentum strategy (`backend/src/strategies/momentum/index.ts` is a
placeholder), and the live order policy.

**The guide's own timeline expected the protocol freeze today.** Task 0-F is a
scope decision that must happen in the first days (guide §14 permits reducing N,
history length and search budget before the reserved period is inspected).

## Workstreams

| Stream | File | Repo | Suggested owner profile | Tasks |
|---|---|---|---|---|
| 0 Contracts and setup | [momentum-tasks-0-contracts.md](momentum-tasks-0-contracts.md) | both | Project lead plus one rep from each stream | 0-A … 0-F |
| A Data and universe | [momentum-tasks-A-data.md](momentum-tasks-A-data.md) | research-python | Data-minded, pandas/Parquet | A1 … A7 |
| B Signal components | [momentum-tasks-B-signals.md](momentum-tasks-B-signals.md) | research-python | Beginner–intermediate; good first tasks (B1–B3 split across 3 people) | B1 … B6 |
| C Account simulator | [momentum-tasks-C-account.md](momentum-tasks-C-account.md) | research-python | Strongest systems/numerics person (owns the critical path) | C1 … C7 |
| D Calibration | [momentum-tasks-D-calibration.md](momentum-tasks-D-calibration.md) | research-python | Statistics/ML | D1 … D8 |
| E Evaluation, benchmarks, protocol | [momentum-tasks-E-evaluation.md](momentum-tasks-E-evaluation.md) | research-python + docs | Analysis/writing | E1 … E7 |
| P1 Platform strategy | [momentum-tasks-P1-platform-strategy.md](momentum-tasks-P1-platform-strategy.md) | trading-platform (backend) | TypeScript | P1-1 … P1-6 |
| P2 Platform execution | [momentum-tasks-P2-platform-execution.md](momentum-tasks-P2-platform-execution.md) | trading-platform (backend) | TypeScript, broker APIs | P2-1 … P2-7 |
| P3 Dashboard | [momentum-tasks-P3-dashboard.md](momentum-tasks-P3-dashboard.md) | trading-platform (frontend + API) | Frontend | P3-1 … P3-3 |

With fewer people, merge streams in this order: E into D, P3 into P1, A into B.
Never merge C with anything; it is the critical path.

## What can start right now (no dependencies)

| Stream | Tasks startable today |
|---|---|
| 0 | 0-A, 0-B, 0-C, 0-D, 0-E, 0-F |
| A | A1, A2, A3 |
| B | B1, B2, B3 (against synthetic bars and hand-worked values) |
| C | C1, C2, C3 (against stubs of 0-C) |
| D | D1, D2, D4 (on synthetic return series) |
| E | E5, E6 |
| P1 | P1-1 (against hand calculations; golden check added after B6) |
| P2 | P2-1, P2-7 |
| P3 | P3-2 (mock data) |

## Dependency map

```
0-A weekly artifact schema ──► D7, P1-2, P3-1
0-B config ID / grid encoding ─► B5, D3, D4, P1-2
0-C account I/O contract ─────► C4, A6, D6, D7
0-D golden fixture format ────► B6, P1-6
0-E merge T1 ─────────────────► C2
0-F scope decision ───────────► A1 (size), E1 (targets), D8 (run length)

A1 ─► A2, A3 ─► A4 ─► A5 ─► D7, D8
A1 ─► A7 ─► D2 (real descriptors)
A6 ─► C5, E1
B1, B2, B3, B4 ─► B5 ─► B6 ─► P1-6
C1, C2, C3 ─► C4 ─► C5, C6, C7, E1
D1, D2, D3, D4, D5, D6 + C4 + A5 ─► D7 ─► D8 ─► E2, E3
P1-1 ─► P1-3 ─► P1-4 ─► P1-6
P2-1 ─► P2-2, P2-3 ─► P2-4
P1-3 + P2-3 + P2-5 ─► end-to-end paper demo
```

## Proposed calendar (adjust after 0-F)

| Dates | Milestone |
|---|---|
| Nov 13–14 | Wave 0: contracts merged, T1 merged, owners assigned, scope proposal drafted |
| Nov 14–17 | Wave 1: components, fill/exit/sizing pieces, data pulls, weights, surrogate, platform indicators, broker spike |
| **Nov 17** | First C4 + E1 benchmark (300 or reduced N, one early and one late calibration). **Freeze scope (0-F)** |
| Nov 17–20 | Wave 2: D7 weekly calibrator, D8 walk-forward on development weeks, P1-3/P2-3 strategy and exits, parity test |
| **Nov 21** | **Protocol freeze** (E5): universe procedure, formulas, exits, costs, weights, budgets, metrics, acceptance rules |
| Nov 21–25 | Reserved-period run with checkpoints; paper demo stream; quote replay of finalists |
| Nov 25–28 | Bootstrap, charts, report, presentation rehearsal |
| Nov 28–30 | Buffer |

## Working rules (both repos)

- **One task = one branch = one worktree**, named `<name>/MO-<ID>` (for
  example `alex/MO-C4`). Two tasks never edit the same file; each packet's
  **Owns** list is exclusive. Shared files listed as **Coordinate** need a
  heads-up to the other owner first.
- research-python: follow `AGENTS.md` (`uv run pytest`, `uv run ruff check`, no
  data in the repo, ask before changing `contracts/` or adding a dependency).
  Adding `numba` (C5) and the new `calibration/` layer (0-C) need lead approval
  and an ADR.
- trading-platform: follow `AGENTS.md` (typecheck, lint, focused Jest tests; do
  not launch paper or real trading runtimes or run migrations incidentally).
- Every number in the guide is a **provisional default** until the protocol
  freeze (§7, §11). Put them in config, not in code constants, and list them in
  the assumption register (E5).
- **Nothing reads the reserved final period before the freeze.** D8 enforces
  this in code (`reserved_start` guard); reviewers check it.
- Each module has an owner **and a reviewer** from another stream (§16).
