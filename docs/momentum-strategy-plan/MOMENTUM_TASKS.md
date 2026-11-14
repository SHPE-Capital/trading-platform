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

**Built on research-python branch `momentum-e1-real` (2026-11-13, not on `main`):**
0-B (grid, 69,732 configs; the subset rule is inferred, see the handoff), 0-C (account
types, `calibration/` layer, ADR 0013 Proposed), a **rebuilt** minimal T1 (`trade/exits.py`;
the real `juancavallin/T1` branch was not found anywhere), C1 to C4 (account engine),
C5 (Numba kernel, exact parity), B1 to B5 batch forms (incremental forms deferred) with
Numba indicator kernels, A6 (panel loader and synthetic generator), the A1 pull script
and a **pilot pull** (77 symbols), and the E1 harness on the real engine. A stand-in D6
cache and calibration cutoff are on `p1/MO-D6-bench`. Measured numbers are in the config
reference.

Not started: weighting policies, score, search/surrogate, acceptance (D1 to D5), the weekly
calibrator and walk-forward (D7, D8), A2 to A5 (missing bars, corporate actions,
eligibility, universe schedule), the platform momentum strategy
(`backend/src/strategies/momentum/index.ts` is a placeholder), and the live order policy.

**The guide's own timeline expected the protocol freeze today.** Task 0-F is a
scope decision that must happen in the first days (guide §14 permits reducing N,
history length and search budget before the reserved period is inspected).

## Scope and configuration (added 2026-11-13)

- **Everything tunable is configuration.** One typed protocol config (task
  **0-G**) holds every number: N, history years, grid, exits, account caps,
  costs, weights, search budget, seeds, finalists per seed, validation length,
  acceptance floors, bootstrap settings and compute settings. The full list with
  defaults, recommendations and the task that decides each is
  [momentum-config-reference.md](momentum-config-reference.md).
- **Final scope (lead decision, 2026-11-13): N = 1,000 stocks over 10 years**, staged
  (pilot, 300 × 2, 500 × 5, then 1,000 × 10). The measured requirements do not fit the
  development machine: the pull is about 44 h and 126 GB, the panel about 20.5 GB. The
  final run needs a compute host (at least 200 GB disk and 32 GB RAM) or the 500 × 5
  fallback. Details and the settings table are in the config reference.
- **Required design change:** the evaluation cache (D6) is keyed per config and per
  **week chunk**, so an expanding window costs only the new week. Indicator arrays are
  also persisted per chunk (new task **B7**) and identical signal masks are deduplicated.
  See "Reusing work across runs and strategies" in the config reference and the
  [multi-strategy handoff](handoff/multi-strategy-and-benchmark-changes.md).
- **Later ideas** (learned signal ranking, learned entry model, learned sizing,
  exhaustive grid precompute) are in [stream F](momentum-tasks-F-later-ideas.md).
  They are outside the Nov 30 deliverable; the seams they need are listed there.

### What the adjacent research-python repo changed

Checked on 2026-11-13 (`main`):

1. **Study ID collision.** `docs/teams/momentum.md` already defines **RM1–RM8** for
   the ORB program. This plan's study folder was named `rm9-weekly-calibration`;
   it is now `rm9-weekly-calibration`. Add the RM9 row to `docs/teams/momentum.md`
   (E5).
2. **Two momentum programs.** The team guide describes an ORB strategy (SM1, P8,
   R1, RM1–RM8). This board describes the five-component breakout. Decide whether
   they share the exit, cost and sizing studies (RM3, RM5, RM7) or this program
   replaces them. Record it in 0-F.
3. **ML tooling already exists.** RF, MLP, sweeps, MLflow and ONNX export are done;
   LightGBM (M1b), triple-barrier labels (C1c) and the platform ONNX wrapper
   (P2) are open. The surrogate (D4) uses scikit-learn
   `HistGradientBoostingRegressor`, a core dependency, so no new dependency is
   needed. Stream F reuses the rest.
4. **Merge status.** `docs/tasks.md` on `main` lists T1 and T4 as Open; this board
   says they exist on unmerged branches. Confirm in 0-E which are real.
5. **Store scaling.** `data/store.py` rewrites one JSON manifest every 20 units.
   That does not scale to 1,000+ symbols over years. Shard it or move it to
   SQLite before the big pull (A1).
6. **Where code runs.** Decision logic is TypeScript in the platform (P1);
   calibration and account replay stay in research-python (about 1,000 times
   faster than the platform engine); the platform engine is only an independent
   cross-check of finalists (**E8**). The two repos do not share bar stores; the
   weekly config JSON and golden fixtures are the interface. Details, plus the
   widened grid (grid v2, exits and account as parameters) and running several
   strategies at once (**P2-8** shadow policies, the **P2-7** live-symbol-limit
   check), are in [momentum-config-reference.md](momentum-config-reference.md).
7. **Universe builder is config-driven already.** `data/universe.py` reads bins and
   cell sizes from YAML, so A5 should extend it rather than rewrite it.

## Workstreams

| Stream | File | Repo | Suggested owner profile | Tasks |
|---|---|---|---|---|
| 0 Contracts and setup | [momentum-tasks-0-contracts.md](momentum-tasks-0-contracts.md) | both | Project lead plus one rep from each stream | 0-A … 0-G |
| A Data and universe | [momentum-tasks-A-data.md](momentum-tasks-A-data.md) | research-python | Data-minded, pandas/Parquet | A1 … A7 |
| B Signal components | [momentum-tasks-B-signals.md](momentum-tasks-B-signals.md) | research-python | Beginner–intermediate; good first tasks (B1–B3 split across 3 people) | B1 … B6 |
| C Account simulator | [momentum-tasks-C-account.md](momentum-tasks-C-account.md) | research-python | Strongest systems/numerics person (owns the critical path) | C1 … C7 |
| D Calibration | [momentum-tasks-D-calibration.md](momentum-tasks-D-calibration.md) | research-python | Statistics/ML | D1 … D8 |
| E Evaluation, benchmarks, protocol | [momentum-tasks-E-evaluation.md](momentum-tasks-E-evaluation.md) | research-python + docs | Analysis/writing | E1 … E7 |
| P1 Platform strategy | [momentum-tasks-P1-platform-strategy.md](momentum-tasks-P1-platform-strategy.md) | trading-platform (backend) | TypeScript | P1-1 … P1-6 |
| P2 Platform execution | [momentum-tasks-P2-platform-execution.md](momentum-tasks-P2-platform-execution.md) | trading-platform (backend) | TypeScript, broker APIs | P2-1 … P2-7 |
| P3 Dashboard | [momentum-tasks-P3-dashboard.md](momentum-tasks-P3-dashboard.md) | trading-platform (frontend + API) | Frontend | P3-1 … P3-3 |
| F Later ideas (not in the Nov 30 scope) | [momentum-tasks-F-later-ideas.md](momentum-tasks-F-later-ideas.md) | research-python (+ platform for ONNX) | Statistics/ML, after the freeze | F1 … F4 |

With fewer people, merge streams in this order: E into D, P3 into P1, A into B.
Never merge C with anything; it is the critical path.

## What can start right now (no dependencies)

| Stream | Tasks startable today |
|---|---|
| 0 | 0-A, 0-B, 0-C, 0-D, 0-E, 0-F, 0-G |
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
0-G protocol config ──────────► every stream reads its numbers from it

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
  freeze (§7, §11). Put them in the protocol config (0-G), not in code
  constants, and list them in the assumption register (E5). A tunable numeric
  literal in module code is a review defect. The inventory is
  [momentum-config-reference.md](momentum-config-reference.md).
- **Nothing reads the reserved final period before the freeze.** D8 enforces
  this in code (`reserved_start` guard); reviewers check it.
- Each module has an owner **and a reviewer** from another stream (§16).
