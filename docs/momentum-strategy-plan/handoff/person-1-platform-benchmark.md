# Person 1: platform and benchmark

Back to [README.md](README.md). You work mostly in `trading-platform` (backend and
frontend) plus the E1 benchmark harness in `research-python`.

## Your tasks

| Order | Task | Stream file | Needs from Person 2 | Agent brief |
|---|---|---|---|---|
| 1 | **P2-7** bar arrival recorder. **Start with the symbol-limit check** (Alpaca free websocket cap, believed about 30; one stream per account) | [P2](../momentum-tasks-P2-platform-execution.md) | nothing | [p2-execution](agents/p2-execution.md) |
| 1 | **P2-1** Alpaca order-behavior spike | P2 | nothing | p2-execution |
| 1 | **P1-1** indicators (ATR, ADX, rolling high, clock RVOL, session VWAP), hand-worked tests | [P1](../momentum-tasks-P1-platform-strategy.md) | nothing | [p1-strategy](agents/p1-strategy.md) |
| 1 | **P3-2** dashboard on mock data | [P3](../momentum-tasks-P3-dashboard.md) | nothing | [p3-dashboard](agents/p3-dashboard.md) |
| 1 | **E1** commit and clean up the harness (below) | [E](../momentum-tasks-E-evaluation.md) | nothing | [p4-benchmark](agents/p4-benchmark.md) |
| 1 | **E6** compute intake (your machine profile feeds it) | E | nothing | p4-benchmark |
| 1 | **0-D** approve the golden fixture format | [0](../momentum-tasks-0-contracts.md) | 0-D draft | you |
| 2 | **P1-2** weekly config loader (fails closed) | P1 | 0-A, 0-B | p1-strategy |
| 2 | **P1-3** `BreakoutMomentumStrategy` and manifest | P1 | P1-1, P1-2 | p1-strategy |
| 2 | **P2-2** quote-gated entry order, **P2-3** exit state machine, **P2-4** daily halt, **P2-5** session guard, **P2-6** audit trail | P2 | P2-1, P1-3 where noted | p2-execution |
| 2 | **P3-1** artifact storage and API, **P3-3** policy dashboard | P3 | 0-A, E2 JSON for P3-3 | p3-dashboard |
| 3 | **P1-4** allocation, **P1-5** exits wiring, **P1-6** golden parity test | P1 | **B6** golden files | p1-strategy |
| 3 | **E1 real numbers** (steps 3 and 4) | E | **C4 + B5 + A6** | p4-benchmark |
| 3 | **P2-8** shadow policies (one live, two signal-only) | P2 | P1-3, P1-2 | p2-execution |
| 4 | **E8** platform-engine cross-check of finalists | E | P1-3, B6, **D8** finalists | p4-benchmark |

Order 1 can all start today. Order 2 waits only on the small Wave 0 contracts.

## E1 state right now

Built in `research-python` on branch `momentum-e1-bench` (uncommitted):
`scripts/momentum/bench.py`, `tests/unit/test_momentum_bench.py` (5 tests), `psutil`
as a dev dependency, results under `studies/momentum/rm1-weekly-calibration/bench/`.
Steps 1 and 2 ran on a stand-in replay with synthetic bars (about 6 ms per candidate
cold, 98% cache hits, 548 MB/s parquet read, 277 MB peak RAM). Steps 3 and 4 are
blocked on C4, B5 and A6. Treat every number as a floor.

Do now:

1. **Rename the results folder** to `studies/momentum/rm9-weekly-calibration/bench/`
   (the plan renamed the study; RM1 to RM8 belong to the ORB program).
2. Get **lead sign-off on `psutil`**, then commit the branch by path.
3. Read N, history years and search budget from the protocol config (0-G) once it
   exists, instead of the placeholder 52 weeks × 3 × 3 × 252.
4. Add the **scale matrix** from E1: N in {300, 500, 1,000} × years in {2, 5, 10},
   recording 1, 8 and 16 thread timings, RAM per worker and total, panel and disk
   bytes, pull time. Project the full run **with and without the week-chunk cache**
   (D6).
5. When C4, B5 and A6 land, swap the stand-in kernel for the real account replay.
6. Send the one-page table to the lead by **Nov 17**.

## What you hand to Person 2

- **0-D approval** (reader side of the golden format).
- **P2-7 result** (arrival latency percentiles, the 1 s batch deadline recommendation,
  the measured symbol limit) **before Nov 21**, because it can change the research
  replay.
- **E1 table** for the 0-F decision on Nov 17.
- Early warning when the TypeScript indicators disagree with Python (P1-1 against B1
  to B3 hand-worked values).

## Platform cautions

- Do not start the combined dev command; it runs paper and real runtimes.
- No migrations, broker calls or data pulls as incidental checks. `bench:paper`,
  `bench:capture` and P2-1/P2-7 touch Alpaca: use your own keys and say so.
- Alpaca free plan: one data stream per account; IEX quotes go quiet (STALE_QUOTE
  rejects); SIP history is allowed except the latest 15 minutes. P2-8 must not give
  shadow instances capital reservation.
- Checks: `npm --prefix backend run typecheck`, `npm --prefix backend run lint`,
  `npm --prefix backend test -- --runInBand <path>`, and for the frontend
  `npm --prefix frontend run lint`, `run test`, `run build`. Read the installed Next.js
  docs before frontend changes (`frontend/AGENTS.md`).

## Using agents

Delegate whole slices, one worktree each, after you define file ownership:
`p1-strategy`, `p2-execution`, `p3-dashboard` and `p4-benchmark` (briefs in
`agents/`). P1 and P2 both touch `core/` neighbors: **Coordinate** on
`core/engine/orchestrator.ts`, `core/oms/` and `strategyCatalog.ts` before two
agents edit them. Use an independent reviewer for substantial behavior changes
(`pr-review-toolkit:review-pr`) and `reliability-auditor` before any paper run.
