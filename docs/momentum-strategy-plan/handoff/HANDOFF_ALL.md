# Momentum handoff: everything in one file

Generated from the files in this folder; edit those and regenerate. Relative links inside sections point at the individual files.


---

<!-- source: README.md -->

# Momentum handoff

Written 2026-11-13. Presentation deadline Nov 30 2026. Protocol freeze Nov 21.
Scope decision (0-F) Nov 17.

Source plan: [../MOMENTUM_TASKS.md](../MOMENTUM_TASKS.md) (board and dependency
map), the stream files `../momentum-tasks-*.md` (full task packets with owned
files and "done when"), and [../momentum-config-reference.md](../momentum-config-reference.md)
(every tunable, scope recommendation, architecture decisions). These handoff files
**do not replace the packets**. They say who does what, in what order, what to wait
for, and what to hand over.

## Who does what

| Person | Works in | Owns |
|---|---|---|
| **Person 1: platform and benchmark** | `trading-platform` (backend, frontend); the E1 harness in `research-python` | P1 strategy port, P2 execution, P3 dashboard, E1 benchmark, E6 compute intake, E8 platform cross-check |
| **Person 2: strategy and research** | `research-python` | Stream 0 contracts, A data, B signals, C account simulator, D calibration, E2–E5 and E7, later stream F |

Read your person file first, then the agent briefs for the slices you delegate.

| File | For |
|---|---|
| [person-1-platform-benchmark.md](person-1-platform-benchmark.md) | Person 1 |
| [person-2-strategy-research.md](person-2-strategy-research.md) | Person 2 |
| [agents/](agents/) | One brief per agent slice (copy into the agent prompt) |
| [HANDOFF_ALL.md](HANDOFF_ALL.md) | Everything in one file (generated from the files above) |

Agent briefs: `agents/p1-*` to `agents/p4-*` are Person 1's slices,
`agents/r0-*` to `agents/r5-*` are Person 2's.

## Rules both people and every agent follow

- **One task = one branch = one worktree**, named `<name>/MO-<ID>`. Two tasks never
  edit the same file; a packet's **Owns** list is exclusive. Files marked
  **Coordinate** need a heads-up to the other owner first.
- Other Claude sessions may share the same checkout. **No `git stash`; stage your own
  files by path; never `git add -A`.**
- research-python: `AGENTS.md` (`uv run pytest`, `uv run ruff check`, no data in the
  repo, ask before changing `contracts/` or adding a dependency). Adding `numba` (C5),
  `psutil` (E1) and the `calibration/` layer (0-C) need lead approval and an ADR.
- trading-platform: `AGENTS.md` (typecheck, lint, focused Jest tests). **Do not launch
  the paper or real trading runtimes, run migrations, pull data or call the broker
  incidentally.** Preserve synchronous in-order event dispatch and deterministic
  replay.
- Every number is a field in the protocol config (task 0-G), not a code constant.
- **Nothing reads the reserved final period before the freeze.** D8 enforces this in
  code; reviewers check it.
- Each module has an owner **and a reviewer from the other person**.
- Verify with the real commands and report what ran. Never claim a check passed
  without seeing the output.
- Every agent ends with: what changed (files), verification run and results,
  unresolved risks.

## Handoff contracts between the two people

| Contract | Written by | Read by | Needed by |
|---|---|---|---|
| **0-A** weekly config artifact schema and JSON Schema | Person 2 | Person 1 (P1-2, P3-1) | Nov 14 |
| **0-B** config grid and stable config ID | Person 2 | Person 1 (P1-2, P1-3) | Nov 14 |
| **0-C** account I/O types (`MarketPanel`, `SignalMask`, `AccountResult`) | Person 2 | Person 1 (E1) | Nov 14 |
| **0-D** golden parity fixture format | Person 2 | Person 1 approves (P1-6) | Nov 14 |
| **B6** golden fixtures | Person 2 | Person 1 (P1-6, E8) | about Nov 19 |
| **C4 + B5 + A6** working engine, masks, panel | Person 2 | Person 1 (real E1) | about Nov 16 |
| **E1 table** (time, RAM, disk per N and years) | Person 1 | Lead, for 0-F | Nov 17 |
| **P2-7** bar arrival timing and symbol limit | Person 1 | Person 2 and lead (can change the replay) | before Nov 21 |
| **D8 finalists** | Person 2 | Person 1 (E8) | after the run |

## Decisions the lead owns

Scope (0-F, due Nov 17): N (recommended 500, stretch 1,000), history 5 to 10 years,
search budget and seeds, finalists per seed, quote replay in or out, reserved-period
date, live universe option (from P2-7), whether this program shares the ORB team's
RM3/RM5/RM7 studies, compute host. Also approve: the `numba` and `psutil`
dependencies, the `calibration/` ADR, the live policy (one live, two shadow), and
whether to add a deployment and scheduling task (see the open item below).

## Open items nobody owns yet

- **Deployment and scheduling of the weekly calibration job** (container, schedule,
  alerting, credentials). Not in any packet. Recommended: add a short task and ADR.
- **E1 status note** in `../momentum-tasks-E-evaluation.md` is uncommitted (made by
  another session).
- **RM1 → RM9 rename.** The plan now uses `studies/momentum/rm9-weekly-calibration/`;
  the E1 harness branch wrote to `rm1-weekly-calibration/`. Move it before committing.
- Guide §13 and §14 (the spec behind E1) are not in either repo. Only the plan text
  is available.

---

<!-- source: person-1-platform-benchmark.md -->

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

---

<!-- source: person-2-strategy-research.md -->

# Person 2: strategy and research (research-python)

Back to [README.md](README.md). You work in `research-python`. Branch names
`<name>/MO-<ID>`. Read its `AGENTS.md` first.

**This is the larger load.** It contains the critical path (C4). Stream C is never
merged with anything else. Use agents for the separable pieces (listed below), and
see "If time runs short" for what to cut.

## Your tasks, in waves

### Wave 0 (Nov 13 to 14): contracts everyone else waits on

| Task | What | Agent brief |
|---|---|---|
| **0-C** account I/O contract, `calibration/` layer, ADR 0013 | Unblocks C4, A6, D6, D7 and Person 1's E1. Needs lead approval for the ADR | [r0-contracts](agents/r0-contracts.md) |
| **0-A** weekly config artifact schema (pydantic plus JSON Schema) | Person 1 needs it for P1-2 and P3-1 | r0-contracts |
| **0-B** config grid and stable config ID (69,732 configs by default, domain loaded from config) | Person 1 needs it for P1-2 | r0-contracts |
| **0-G** protocol config (`MomentumProtocol`) | Every number comes from here | r0-contracts |
| **0-D** golden parity fixture format | Person 1 approves it | r0-contracts |
| **0-E** merge the T1 trade simulator branch `juancavallin/T1` | Unblocks C2. Check which of T1 and T4 really exist (`docs/tasks.md` on main says Open) | you (git work, do it carefully) |
| **0-F** scope proposal (draft) | The lead decides Nov 17 | you plus Person 1's E1 table |

### Wave 1 (Nov 14 to 17): run in parallel

| Slice | Tasks | Notes | Agent brief |
|---|---|---|---|
| **Signals** | B1, B2, B3 (independent), then B4, B5, B6 | Batch and incremental forms must agree. B6 golden files unblock Person 1's P1-6 and E8 | [r2-signals](agents/r2-signals.md) |
| **Account (critical path)** | C1, C2, C3 (separable), then **C4**; C7 tests written first | C4 must land about **Nov 16** for a real E1 | [r3-account](agents/r3-account.md) |
| **Data** | A1 (pilot pull first), A2, A3, then A4, A5, A6, A7 | Fix the manifest scaling before the big pull. A6 is needed for E1 | [r1-data](agents/r1-data.md) |
| **Calibration** | D1, D2, D4 on synthetic series now; D3, D5, D6 against fakes once 0-B and 0-C land | D6 caches per config and per week chunk | [r4-calibration](agents/r4-calibration.md) |
| **Evaluation** | E5 study folder and assumption register, E4 as skipped tests, E2 and E3 on synthetic series | E6 and E1 are Person 1's | [r5-evaluation](agents/r5-evaluation.md) |

### Wave 2 (Nov 17 to 21)

- **C5** Numba pass (needs `numba` ADR and lead approval), start a thin kernel beside C4.
- **D7** weekend calibrator, **D8** walk-forward driver (needs D1 to D6, C4, B5, A5, 0-A).
- **E4** leakage and reproducibility tests un-skipped.
- **E5** frozen protocol and hash, **Nov 21 freeze**.

### After the freeze

Reserved-period run with checkpoints, then **E2** report and bootstrap, **E3**
diagnostics, **E7** presentation. **C6** quote replay if in scope. Stream F (learned
ranking, entry model, sizing) is **not** part of Nov 30.

## What you wait for

| From | What | Needed for |
|---|---|---|
| Lead | 0-C ADR approval; `numba` approval; 0-F decision (Nov 17) | C4, C5, A1 sizing, D8 length |
| Person 1 | 0-D approval | B6, P1-6 |
| Person 1 | E1 table | 0-F |
| Person 1 | P2-7 arrival timing, symbol limit | can change the replay semantics before the freeze |

## What you hand to Person 1

0-A, 0-B, 0-C, 0-D early (Nov 14); B6 golden fixtures (about Nov 19); a working
C4 + B5 + A6 (about Nov 16) so E1 can swap its stand-in; D8 finalists for E8.

## Design points to keep

- Search and validation replays start every session from a **fixed reference equity**,
  so a session's return does not depend on other sessions (lets D6 cache per week
  chunk). Forward accounts carry real equity. The lead should confirm this against
  guide §12.
- C4 and D3 expose the seams stream F needs (ranker function, optional entry-score
  threshold, size-multiplier input, candidate features in the ledger), all off by default.
- Keep pure-Python C4 as the oracle for C5.
- Selection at a cutoff must never read a cache chunk at or after the cutoff (E4 test).

## If time runs short (cut in this order)

1. C6 quote replay.
2. Number of seeds, then search budget.
3. History length, then N (the plan's own fallback). Keep the 300-stock, 2-year stage
   working before reaching for 500 and 1,000.
4. Never cut: C4 correctness (C7), the leakage tests, the protocol hash and the
   reserved-period guard.

## Using agents

Separable slices that can run at once in separate worktrees: B1, B2, B3; C1, C2, C3;
A1 and A2 and A3; D1, D2 and D4. Never two agents on the same file; the contracts
(0-A to 0-G) should be one agent. Review rule: Person 1 reviews your platform-facing
contracts; an independent reviewer (`pr-review-toolkit:review-pr`) checks C4 and the
leakage tests.

---

<!-- source: agents/p1-strategy.md -->

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

---

<!-- source: agents/p2-execution.md -->

# Agent brief: platform execution (P2)

Suggested agent: `feature-implementer`; run `reliability-auditor` before any paper run. Owner: Person 1. Repo: **trading-platform**, backend.
Full packets: [../../momentum-tasks-P2-platform-execution.md](../../momentum-tasks-P2-platform-execution.md).

Follow the shared rules in [../README.md](../README.md): one task, one branch, one worktree (`<name>/MO-<ID>`); exclusive Owns lists; stage your own files by path (no `git stash`, no `git add -A`); every tunable comes from the protocol config (0-G); never claim a check passed without seeing it run. End with: what changed (files), verification and results, unresolved risks.

## Goal
Make orders, exits, the daily halt and the session guard behave correctly against Alpaca paper, with an audit trail, and measure real feed timing.

## Tasks, in order
1. **P2-7 bar arrival recorder.** First verify the free-plan websocket **symbol cap** (believed about 30) and one-stream-per-account on our keys. Report the chosen live-universe option (top-K subset, REST polling, or paid plan). Read-only market data only.
2. **P2-1 order-behavior spike** (partial fills on IOC, paper fill timing about 1 s).
3. **P2-2 quote-gated entry order**, **P2-3 exit state machine and protective stops**, **P2-4 daily 1% halt with liquidation**, **P2-5 session guard** (pre-open reconciliation and health), **P2-6 audit trail and corrected bars**.
4. **P2-8 shadow policies:** one policy live, two signal-only. No capital reservation for shadow instances. Check what `core/live/signalRecorder.ts` records.

## Known platform facts
Free plan: one data stream per account; IEX quotes go quiet (STALE_QUOTE rejects); SIP history is allowed except the latest 15 minutes; paper fills about 1 s after submit and multi-share IOC orders partially fill.

## Do not
Launch the combined dev command, run migrations, or send orders beyond bounded paper probes with your own keys. Coordinate on `core/oms/` and `core/engine/orchestrator.ts`.

## Verify
Typecheck, lint, focused Jest. Document any live probe results with timestamps.

---

<!-- source: agents/p3-dashboard.md -->

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

---

<!-- source: agents/p4-benchmark.md -->

# Agent brief: benchmark and compute (E1, E6, E8)

Suggested agent: `general-purpose` or `feature-implementer`. Owner: Person 1. Repos: **research-python** (harness) and trading-platform (E8).
Full packets: [../../momentum-tasks-E-evaluation.md](../../momentum-tasks-E-evaluation.md) (E1, E6, E8) and [../../momentum-config-reference.md](../../momentum-config-reference.md).

Follow the shared rules in [../README.md](../README.md): one task, one branch, one worktree (`<name>/MO-<ID>`); exclusive Owns lists; stage your own files by path (no `git stash`, no `git add -A`); every tunable comes from the protocol config (0-G); never claim a check passed without seeing it run. End with: what changed (files), verification and results, unresolved risks.

## State
The E1 harness exists in research-python on branch `momentum-e1-bench` (uncommitted): `scripts/momentum/bench.py`, `tests/unit/test_momentum_bench.py`, and `psutil` as a dev dependency. Steps 1 and 2 ran on a stand-in replay. Steps 3 and 4 are blocked on C4, B5 and A6. Rename its results folder from `rm1-` to `rm9-weekly-calibration`. `psutil` needs lead sign-off.

## Tasks
1. **Commit the harness** (by path) after the rename and sign-off.
2. **E6 compute intake** (`docs/compute/momentum_resources.md`): this machine is a Ryzen 7 3700X (8 cores, 16 threads), 15.9 to 17 GB RAM with only about 2.4 to 3.4 GB free, and a 2 TB NVMe with about 80 to 86 GB free. Add AWS, university HPC and teammate laptops.
3. **E1 real numbers** once C4, B5 and A6 exist: swap in the real replay; add the scale matrix N in {300, 500, 1,000} by years in {2, 5, 10}; record 1, 8 and 16 thread timings, RAM per worker and total, panel and disk bytes, and pull time; project the full run with and without the D6 week-chunk cache; read settings from 0-G. Deliver the one-page table by **Nov 17**.
4. **E8 platform cross-check** (after P1-3, B6, D8): replay a few finalists and weeks through the platform backtest engine and classify every difference.

## Rules
Run benchmarks natively, not in Docker (the compose CPU cap skews results). Never present a stand-in number as a C4 number. Do not touch the reserved period.

---

<!-- source: agents/r0-contracts.md -->

# Agent brief: contracts and setup (stream 0)

Suggested agent: `feature-implementer`, **one agent for all of 0-A to 0-D and 0-G** (they interlock). Owner: Person 2. Repo: **research-python**.
Full packets: [../../momentum-tasks-0-contracts.md](../../momentum-tasks-0-contracts.md).

Follow the shared rules in [../README.md](../README.md): one task, one branch, one worktree (`<name>/MO-<ID>`); exclusive Owns lists; stage your own files by path (no `git stash`, no `git add -A`); every tunable comes from the protocol config (0-G); never claim a check passed without seeing it run. End with: what changed (files), verification and results, unresolved risks.

## Goal
Small, fast interfaces that unblock every other stream. Types, docstrings, a stub or fixture; not implementations. All merged by **Nov 14**; the lead reviews all of them.

## Tasks
- **0-C** `trade/account_types.py` (`MarketPanel`, `AccountConfig`, `SignalMask`, `AccountResult`), an empty `calibration/` package, ADR 0013, the import-linter entry, and a stub `simulate_account` raising `NotImplementedError("TODO(MO-C4)")`. `AccountConfig` includes the ranking function name, optional entry-score threshold, size-multiplier input and a search-replay reference equity (defaults reproduce the guide).
- **0-A** `contracts/weekly_config.py`, the exported JSON Schema, and example selected and `no_deployment` artifacts.
- **0-B** `strategies/momentum/breakout/grid.py`: versioned domain loaded from config, `Config`, `config_id`, `enumerate_configs` (69,732 for the default grid, 14 subsets), `is_valid`, `feature_vector`.
- **0-G** `config/momentum.py` (`MomentumProtocol`, `extra="forbid"`, content hash, `--set` overrides refused when frozen) and `configs/momentum/protocol.default.yaml`. Parameter list: [../../momentum-config-reference.md](../../momentum-config-reference.md).
- **0-D** `docs/contracts/momentum_golden.md`: JSON Lines or CSV (not Parquet) layout both languages read; Person 1 approves.
- **0-E** (git work, not an agent job) merge `juancavallin/T1`; check which of T1 and T4 actually exist.

## Needs approval
The `calibration/` layer ADR. Ask before changing `contracts/`.

## Verify
`uv run pytest`, `uv run ruff check`, `lint-imports`.

---

<!-- source: agents/r1-data.md -->

# Agent brief: data and universe (stream A)

Suggested agent: `general-purpose` or `feature-implementer`; A1, A2 and A3 can run as separate agents. Owner: Person 2. Repo: **research-python**.
Full packets: [../../momentum-tasks-A-data.md](../../momentum-tasks-A-data.md).

Follow the shared rules in [../README.md](../README.md): one task, one branch, one worktree (`<name>/MO-<ID>`); exclusive Owns lists; stage your own files by path (no `git stash`, no `git add -A`); every tunable comes from the protocol config (0-G); never claim a check passed without seeing it run. End with: what changed (files), verification and results, unresolved risks.

## Tasks
1. **A1 archive audit and pull.** Start with a **two-year pilot**; size follows 0-F (recommended N 500 to 1,000, 5 to 10 years, pool about 3 times N, includes delisted names). Use the SIP feed for research. **Measure the real rate limit and bars per request.** Before the big pull, **shard or replace the JSON manifest** in `data/store.py` (it rewrites everything every 20 units) and check free disk. Pulls must be resumable. Needs Alpaca data keys in `.env`; do not commit them.
2. **A2** missing-bar classification, **A3** corporate actions and stable asset IDs.
3. **A4** weekly eligibility screen, **A5** weekly universe schedule (extend the config-driven `data/universe.py`), **A7** market descriptors.
4. **A6** memory-mappable panel loader, **needed early by Person 1's E1**. Build per week chunk; 1,000 stocks by 10 years is about 20 GB, more than this machine's RAM.

## Do not
Put data in the repo, or read the reserved period. Run data pulls only as the task states.

## Verify
`uv run pytest`, `uv run ruff check`, plus the future-bar tamper test for A4.

---

<!-- source: agents/r2-signals.md -->

# Agent brief: signal components (stream B)

Suggested agents: **three `feature-implementer` agents in parallel for B1, B2, B3**, then one for B4 to B6. Owner: Person 2. Repo: **research-python**.
Full packets: [../../momentum-tasks-B-signals.md](../../momentum-tasks-B-signals.md).

Follow the shared rules in [../README.md](../README.md): one task, one branch, one worktree (`<name>/MO-<ID>`); exclusive Owns lists; stage your own files by path (no `git stash`, no `git add -A`); every tunable comes from the protocol config (0-G); never claim a check passed without seeing it run. End with: what changed (files), verification and results, unresolved risks.

## Goal
The reference implementation of the five components (Appendix A). The platform ports it, so every indicator needs a vectorized batch form and an incremental per-bar form that agree to a documented tolerance.

## Tasks
- **B1** Wilder ATR14 and ADX/±DI. **B2** rolling-high breakout (current bar excluded) and EMA trend. **B3** clock-window relative volume (median of 20 prior sessions, at least 15 windows) and session VWAP band. Do not change the existing `relative_volume.py` or `vwap_distance.py`.
- **B4** warm-up and readiness (five times the longest recursive length, convergence report).
- **B5** `signal_mask(panel, config) -> SignalMask` with an indicator cache keyed per parameter setting. Needs 0-B and B1 to B4. Feeds C4.
- **B6** golden parity fixtures (2 to 3 small scenarios, including an early close, a missing minute and a warm-up boundary). Needs 0-D. **Person 1 needs them for P1-6 and E8.**

## Rules
Zero denominators, missing inputs or insufficient warm-up mean the signal is invalid, never true. Use completed regular-session bars only. Document tolerance rather than rounding prices.

## Verify
`uv run pytest`, `uv run ruff check`; batch versus incremental parity tests; a 1,000-config cache-hit test on a 30-stock by 20-session panel.

---

<!-- source: agents/r3-account.md -->

# Agent brief: funded account simulator (stream C, critical path)

Suggested agents: three `feature-implementer` agents for C1, C2, C3 (pure functions), **the strongest agent or Person 2 on C4**, and a second agent writing C7 first. Owner: Person 2. Repo: **research-python**. Never merge stream C with other work.
Full packets: [../../momentum-tasks-C-account.md](../../momentum-tasks-C-account.md).

Follow the shared rules in [../README.md](../README.md): one task, one branch, one worktree (`<name>/MO-<ID>`); exclusive Owns lists; stage your own files by path (no `git stash`, no `git add -A`); every tunable comes from the protocol config (0-G); never claim a check passed without seeing it run. End with: what changed (files), verification and results, unresolved risks.

## Tasks
1. **C1** screening fill proxy and cost scenarios (5, 10, 20 bps). **C2** common trailing exit package (needs T1 merged; **Coordinate** before editing `trade/exits.py`). **C3** sizing and capacity (the 160-share worked example must pass, plus a test where each cap binds).
2. **C7** correctness scenarios, written **before** C4 (test-first).
3. **C4** `trade/account.py`: chronological multi-stock engine. Ranking is a named function (default dollar volume with asset-ID tie-break); optional entry-score and size-multiplier hooks are off by default; search replays use a fixed reference equity. Deterministic, byte-identical output. **Target: working by about Nov 16** so Person 1's E1 can use it.
4. **C5** Numba pass (needs lead approval and an ADR). Start a thin kernel beside C4; keep pure Python as the oracle; match exactly or within a stated tolerance; profile at N = 300, 500, 1,000. Mind the memory-bound thread scaling.
5. **C6** quote replay for finalists, if 0-F keeps it in scope.

## Verify
`uv run pytest`, `uv run ruff check`; the C7 suite; a determinism test; Numba parity on random configs.

---

<!-- source: agents/r4-calibration.md -->

# Agent brief: calibration (stream D)

Suggested agents: D1, D2, D4 in parallel now (synthetic series); D3, D5, D6 after 0-B and 0-C; D7 and D8 integrate. Owner: Person 2. Repo: **research-python**, package `calibration/`.
Full packets: [../../momentum-tasks-D-calibration.md](../../momentum-tasks-D-calibration.md).

Follow the shared rules in [../README.md](../README.md): one task, one branch, one worktree (`<name>/MO-<ID>`); exclusive Owns lists; stage your own files by path (no `git stash`, no `git add -A`); every tunable comes from the protocol config (0-G); never claim a check passed without seeing it run. End with: what changed (files), verification and results, unresolved risks.

## Tasks
- **D1** score J (coefficient from config). **D2** weights: Uniform, Recency, Similarity, 20% uniform mix, ESS target about 60% solved without looking at returns; scaling fitted on search history only. **D4** surrogate: five scikit-learn `HistGradientBoostingRegressor`s, mean and disagreement.
- **D3** group-aware evolutionary search: budget, seeds, population, proposals, evaluations per round and their split, and finalists per seed all come from config; deterministic per seed; full audit trail.
- **D5** acceptance rules and finalist selection (floors from config; also report every finalist at 20 bps).
- **D6** evaluation cache **per config and per week chunk**; weight changes reuse paths; selection at a cutoff never reads a chunk at or after the cutoff.
- **D7** weekend calibrator (needs D1 to D6, C4, B5, A5, 0-A), **D8** walk-forward driver with forward accounts, resume-after-kill and the hard `reserved_start` guard.

## Rules
Never read the reserved period before the frozen protocol hash. A crashed job is an operational failure, resumed from checkpoint, never filled with an invented result.

## Verify
`uv run pytest`, `uv run ruff check`; planted-optimum test for D3; ESS and fallback tests for D2; resume-after-kill for D8.

---

<!-- source: agents/r5-evaluation.md -->

# Agent brief: evaluation, protocol and presentation (E2 to E5, E7)

Suggested agent: `general-purpose`; `pr-review-toolkit` reviewers for leakage tests. Owner: Person 2. Repo: **research-python** plus docs. (E1, E6 and E8 are Person 1's.)
Full packets: [../../momentum-tasks-E-evaluation.md](../../momentum-tasks-E-evaluation.md).

Follow the shared rules in [../README.md](../README.md): one task, one branch, one worktree (`<name>/MO-<ID>`); exclusive Owns lists; stage your own files by path (no `git stash`, no `git add -A`); every tunable comes from the protocol config (0-G); never claim a check passed without seeing it run. End with: what changed (files), verification and results, unresolved risks.

## Tasks
- **E5** (start now): `studies/momentum/rm9-weekly-calibration/` with README, protocol, assumptions register (each setting with value, why, evidence, what would change it) and notes; add the **RM9** row to `docs/teams/momentum.md`. The frozen protocol is the resolved 0-G YAML with a content hash. **Freeze Nov 21.**
- **E4** leakage and reproducibility tests: write as skipped tests now; assert earlier signals, universe and artifacts do not change when a later bar is tampered with; identical config and seed give identical artifacts; selection never reads cache chunks after the cutoff.
- **E2** policy comparison report on synthetic series first: paired block bootstrap of Similarity minus Recency (5-session blocks, 10 and 20 as sensitivity, resamples from config), same blocks for both policies; emit the JSON summary for P3-3.
- **E3** search diagnostics (score versus budget, seed stability, boundary optima, neighbor check, surrogate rank correlation).
- **E7** presentation package (rehearsal by Nov 27).

## Rules
Do not touch the reserved period before the freeze. Report results honestly, including no difference or no-deployment weeks.
