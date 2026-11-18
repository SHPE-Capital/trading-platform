# Intraday momentum: status and task board

Source: *Intraday Momentum Research and Implementation Guide*, design version 3. Section
numbers (§) refer to that guide. **Protocol freeze Nov 21 2026; presentation Nov 30 2026.**

The remaining work is split across **four teammates**. Each has one file with their task
packets (owned files, dependencies, "done when"):

| Teammate | Focus | Repo | Packets | Key date |
|---|---|---|---|---|
| **1 Data** | Real data into the calibrator: pull audit, panel build on HiPerGator, missing bars, identity, eligibility, weekly universe, market descriptors | research-python | [teammate-1-data.md](teammate-1-data.md) | universe schedule and descriptors on HPG by **Nov 20** |
| **2 Calibration** | Protocol config, corrected benchmark, real-data calibration and walk-forward, leakage tests, freeze, reserved run | research-python | [teammate-2-calibration.md](teammate-2-calibration.md) | freeze **Nov 21**, reserved run Nov 21 to 25 |
| **3 Evaluation** | Policy comparison report, search diagnostics, dashboard on real results, presentation | research-python, trading-platform frontend | [teammate-3-evaluation.md](teammate-3-evaluation.md) | report Nov 26, rehearsal **Nov 27** |
| **4 Platform** | Broker and bar-timing runs, research-to-platform artifact path, paper demo, platform cross-check | trading-platform | [teammate-4-platform.md](teammate-4-platform.md) | bar timing before **Nov 21**, demo by Nov 26 |

Every tunable number and the scope decisions are in [config-reference.md](config-reference.md).
Learned components (ranking, entry model, sizing) are after Nov 30: [later-ideas.md](later-ideas.md).

## Status (2026-11-18)

### Running now

- **HiPerGator:** the 500 × 5 pull over the 1,500-ticker interim pool (`mo-pull-500x5`,
  store at `/blue/dream_team/$USER/momentum/store`) **finished on Nov 18**. It is not audited
  yet and no panel has been built from it. No other jobs are queued.
- Nothing else runs: no calibration, no paper runtime.

### Built

Task IDs are the original packet IDs (0-A … P3-3); their full text is in git history
(`docs/momentum-strategy-plan/momentum-tasks-*.md` before 2026-11-18).

| Area | Done | Where | Known gaps |
|---|---|---|---|
| Contracts | 0-A weekly artifact schema, 0-B grid (69,732 configs), 0-C account types and `calibration/` layer, 0-D golden format, 0-E T1 merged (Nov 17) | research-python `contracts/`, `strategies/momentum/breakout/grid.py`, `trade/account_types.py` | 0-B subset rule is **inferred** (Appendix A not in the repo); ADR 0013 is still *Proposed* |
| Protocol config (0-G) | Sections for weights, score, search, surrogate, validation, acceptance, cache, compute, walk-forward | `config/momentum.py`, `configs/momentum/protocol.default.yaml` | Universe, data, eligibility, grid, signals, fill, costs, exit, account, bootstrap and quote-replay sections missing (`TODO(MO-0G-rest)`) |
| Data | A1 pull script, interim universe builder, HPG job scripts; A6 week-chunk panels | `scripts/momentum/pull_archive.py`, `build_interim_universe.py`, `hpg/`; `data/panel.py` | No CLI to build panels from the store; A2 to A5 and A7 not built |
| Signals | B1 to B5 batch forms with Numba kernels; B6 golden fixtures | `features/momentum/`, `strategies/momentum/breakout/`, `scripts/momentum/make_golden.py` | Incremental per-bar forms deferred (platform parity passes without them); B7 not built |
| Account | C1 fill proxy, C2 exits, C3 sizing, C4 engine, C5 Numba kernel (exact parity), C7 scenarios | `trade/` | C7 "halt prevents exit" not modelled; C6 quote replay not built |
| Calibration | D1 to D9: score, weights, search, surrogate, acceptance, week-chunk cache, mask dedup, strategy registry, weekend calibrator, walk-forward with reserved-period guard | `calibration/`, `shpe momentum calibrate` and `walkforward` | Runs on stand-ins: `StaticUniverseProvider` (until A5), `PanelProxyDescriptors` (until A7), default `AccountConfig` (until 0-G rest). Never run on real data |
| Benchmark | E1 harness on the real engine; E6 compute intake | `scripts/momentum/bench.py`, `studies/momentum/rm9-weekly-calibration/bench/` | The prepare-once fix is in the code, but `e1_table.md` still holds the **inflated** pre-fix numbers (10 to 15 times too slow). Not rerun |
| Platform strategy | P1-1 indicators, P1-2 weekly config loader, P1-3 strategy and manifest, P1-4 batch allocator, P1-5 funded sizer, P1-6 golden parity (indicators, signals, ranked and sized orders) | trading-platform `backend/src/strategies/momentum/`, `services/indicators/`, `core/sizing/fundedAccountSizer.ts` | none known |
| Platform execution | P2-2 quote-gated entry, P2-3 exit state machine, P2-4 daily halt, P2-5 session guard, P2-6 audit recorder (migration 0020), P2-8 shadow policies; P2-1 and P2-7 scripts and docs | `core/execution/`, `core/live/`, `runtime/verify/` | **P2-1 and P2-7 have never been run**: every Alpaca claim in their docs is unverified |
| Dashboard | P3-1 API and artifact storage (migration 0021), P3-2 live page, P3-3 results view | `app/routes/momentum.ts`, `frontend/features/momentum/` | Results view reads a mock E2 summary |

research-python work is on branch `JC` (D1 to D9 merged into it Nov 17), not yet on `main`.

### Not built

A2 to A5, A7 (stand-ins in use), 0-G remaining sections, E2 report, E3 diagnostics, E4
leakage tests, E5 study folder and freeze, E7 presentation, E8 platform cross-check, C6
quote replay (scope undecided), B7 (optional), the research-to-platform artifact upload, the
end-to-end paper demo, and scheduling of the weekly calibration job.

## Decisions the lead owes

| # | Decision | Blocks | Recommendation |
|---|---|---|---|
| 1 | **Reserved-period start date** (`walkforward.reserved_start`) | every real-data calibration (the guard refuses to run without it) | Declare it today. The pull covers about 2020-11 to 2025-10-31 (script default end; confirm) |
| 2 | Weekly universe for the freeze: real A5 schedule, or the static interim pool if A2 to A5 slip | Teammate 2's first real runs | Decide on Nov 20 from Teammate 1's status; the static pool has survivor bias that must be stated |
| 3 | Quote replay (C6) in or out | Teammate 3's scope | Out for Nov 30; report the 20 bps scenario instead |
| 4 | Which policy runs live (the other two are shadows) | Teammate 4's demo | Pick after the first dev walk-forward |
| 5 | Merge research-python `JC` into `main`; accept ADR 0013 | clean branches for four people | Before Nov 20 |
| 6 | Confirm the 0-B subset rule against Appendix A | the frozen grid | Whoever has the guide; a correction is a new grid version |
| 7 | Whether the ORB studies (RM3, RM5, RM7) are shared | protocol text | Separate programs; say so in the protocol |

## Handoffs between teammates

| What | From | To | Needed by |
|---|---|---|---|
| Panel chunks for the full window on HPG | 1 | 2 | Nov 19 |
| Field lists for the universe, data and eligibility config sections | 1 | 2 (owns `config/momentum.py`) | Nov 19 |
| `WeeklyUniverseProvider` and real descriptor provider | 1 | 2 | Nov 20 |
| Corrected E1 numbers and the chosen budget and workers | 2 | lead, 3 | Nov 19 |
| Dev-week calibration audit trails and walk-forward output | 2 | 3 (E2, E3) | Nov 20 |
| Frozen protocol hash | 2 | everyone | Nov 21 |
| Per-policy daily account series and finalists from the reserved run | 2 | 3 (E2), 4 (E8) | Nov 25 |
| E2 JSON summary | 3 | 4 (upload), dashboard | Nov 26 |
| Bar-timing result and live-universe option | 4 | lead, 2 (can change the replay) | before Nov 21 |
| Weekly artifact upload path | 4 | 2, 3 | Nov 24 |

## Remaining dependencies

```
reserved_start (lead) ─► T2-3 dev calibrations ─► T2-5 freeze ─► T2-6 reserved run
T1-1 audit ─► T1-2 panels ─► T2-2 E1 rerun, T2-3
T1-3 A2, T1-4 A3 ─► T1-5 A4 ─► T1-6 A5 ─┐
T1-7 A7 ───────────────────────────────┴─► T2-3 (or the static fallback)
T2-1 0-G rest ─► T2-3, T2-5
T2-3 ─► T3-2 E3 ─► T2-5;  T2-3 ─► T2-4 E4
T2-6 ─► T3-1 E2 ─► T3-5 E7;  T2-6 ─► T4-5 E8
T4-1 bar timing ─► T2-5 (batch deadline, live universe)
T4-2 broker spike ─► T4-4 paper demo ◄─ T4-3 artifact path
```

## Calendar

| Dates | Milestone |
|---|---|
| Nov 18 | Lead sets `reserved_start`. Pull audit and panel build on HPG start. Bar-timing and broker runs scheduled |
| Nov 19 | Panels on HPG. Corrected E1 on the real panel; budget and workers fixed to fit 70% of the 36 h cap. 0-G rest merged |
| Nov 20 | A5 schedule and A7 descriptors on HPG, or the lead picks the static fallback. Early and late dev calibrations; dev walk-forward starts. E3 and E4 run |
| **Nov 21** | **Protocol freeze** (E5): universe procedure, formulas, exits, costs, weights, budgets, metrics, acceptance rules, hash |
| Nov 21 to 25 | Reserved run on HPG (36 h cap per run, checkpointed). Paper demo. Artifact upload |
| Nov 25 to 27 | E2 report, E8 cross-check, charts, presentation; rehearsal Nov 27 |
| Nov 28 to 30 | Buffer |

## Working rules (both repos)

- **One task = one branch = one worktree**, named `<name>/MO-<ID>`. A packet's **Owns** list
  is exclusive; files marked **Coordinate** need a heads-up to the other owner first.
- Other sessions may share a checkout: no `git stash`, stage files by path, never `git add -A`.
- research-python: follow `AGENTS.md` (`uv run pytest`, `uv run ruff check`, no data in the
  repo, ask before changing `contracts/` or adding a dependency).
- trading-platform: follow `AGENTS.md` (typecheck, lint, focused Jest tests). Do not launch
  paper or real trading runtimes, run migrations or call the broker incidentally.
- Every number is a protocol config field (0-G), never a code constant. A tunable literal in
  module code is a review defect.
- **Nothing reads the reserved period before the freeze.** D8 enforces it in code; reviewers
  check it.
- HiPerGator's `dream_team` QOS (32 CPUs, 250 GB) is shared with every DTE project: announce
  runs above 8 CPUs or use `dream_team-b`.
- Each module has an owner and a reviewer from another teammate. Report what verification
  actually ran.
