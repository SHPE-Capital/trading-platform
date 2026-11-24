# Team 3 Reversal: Master Doc

The living overview of the whole strategy: what's in it, what's left, and where
each piece is documented. **Update this file whenever a component is added,
changes status, or gets ablation results** (see [AGENT_GUIDE.md](AGENT_GUIDE.md)).

**Strategy VERSION:** 3  ·  **Branch:** `team3/reversal`  ·  **Last updated:** 2026-11-21
**Deadlines:** algorithm Nov 22 · paper Nov 25 · presentation Nov 28/30

## The baseline: VWAP reversion ([baseline.md](components/baseline.md))
On today's regular-session 1-minute bars, fade a move only when it leaves price
at least `entryZ` sigmas from VWAP and the way back beats costs (`minEdgeBps`).
Hold until price is back at VWAP (or stop / time limit). Flat by the close.
Fixed dollars per trade, capped per symbol and in gross (shorts included).
Every component below is an on/off switch on top of it.

Reference row: the platform's `beginner_reversal` (fade every bar) under the same protocol.

## The platform contract ([CONTRACT.md](../../backend/src/strategies/team3Reversal/CONTRACT.md))
What we assume from the platform and what we promise back, each row enforced by
`contract.test.ts` against the real backtest engine. Only `contract/` touches
platform code. Platform bugs we work around, for a later PR: [UPSTREAM.md](UPSTREAM.md).

## Research: "Shallow code, deep reasons" ([research/README.md](research/README.md))
Every rule is one line built from primitives we already have, and it earns its
place only by naming the market mechanism that makes it pay. There are six
mechanism categories (R1 liquidity, R2 regime, R3 costs, R4 exit geometry,
R5 portfolio, R6 evidence). The README holds the merged experiment queue,
7 mis-specifications to fix before tuning, and ranked one-line feature
proposals. The S0 diagnostics have run (see [S0 results](#s0-diagnostic-results-in-sample-only)).
**The rules for iterating are in [Testing rules](#testing-rules) and [Iteration rules](#iteration-rules) below. They override any older wording in research/.**

## Testing rules

The short, binding list. Every Stage 2 row follows it, and where anything else in the repo disagrees, this wins.

1. **Universes.** Momentum is the main universe. Core is the control. Every row runs the **same config on both**, and the two are **never tuned separately**.
2. **Keep rule.** A row can only be proposed for the baseline if **all five** hold, measured against the current baseline on the in-sample days:
   1. net P&L improves on **Momentum**;
   2. the **paired day-bootstrap share ≥ 0.8** (`runtime/team3Bootstrap.ts <baselineId> <rowId>`, Momentum, `all.shareBBeatsA`);
   3. the row's **mechanism check moves** in the predicted direction ([table](#mechanism-checks-measurable-before-a-row-runs));
   4. **both in-sample halves agree**: the bootstrap's `firstHalf` and `secondHalf` mean differences are both > 0 (`halvesAgree` and positive);
   5. **Core doesn't contradict it**: Core's effect has the same sign, or is flat.
3. **Budget.** About **30 configs in total** (raised from 20 to 25 on 2026-11-23, the extra 5 being reserve; then to 30 the same day, 5 more for the combining step), and **R3 gets 4**. **Every run goes in the ledger** ([ablation.md](ablation.md)), including diagnostics and failed runs.
4. **Out-of-sample.** The OOS days (**2026-10-16 → 2026-11-20**; end extended from 11-13 by the lead on 2026-11-23, before any OOS run) are **never run before Stage 3**. No runs, plots or peeks. `team3Bootstrap.ts` refuses OOS runs.
5. **Promotion.** **Agents never promote a change to the baseline. The human decides.** An agent reports whether a row passes the keep rule and stops.

## Iteration rules

Copied from the team's Notion page ("operation rmes"). Agents read the repo, not
Notion, so **this section is the source of truth.** Change it here first.

### RMES layers
| Layer | What it is | Run backtests? |
|---|---|---|
| **R**1–R6: research categories | The market mechanism that explains why a rule could pay | No. These are the reasons |
| **M**1–M7: mis-specifications | Bugs or wrong defaults the research found ([list](research/README.md#mis-specifications-found-fix-before-tuning-these-are-corrections-not-tuning)) | No. Fixed in Stage 1, before tuning |
| **Q**-queue: experiments | Ablation rows, each traced to an R | Yes. One row each |
| **S**witches / filters | The code pieces a row turns on or off (`useVwapRegime`, `useVolSizing`, `useRelativeToSpy`, …) | They're what a row changes |

### Universes
- **Momentum is the main universe.** It was chosen from the S0 in-sample diagnostics, before any tuning. Switching to whichever universe looks better *after* tuning or after OOS is overfitting, and it's not allowed.
- **Core is the control.** Every row runs on both universes with the same config. The two are never tuned separately.

### Keep rule
Change **one thing per row**, compared against the *current* baseline. The five conditions are in [Testing rules](#testing-rules), rule 2: net up on Momentum, bootstrap share ≥ 0.8, mechanism check moves (for example, the reversion share rises above Momentum's 17.6%), both IS halves agree, Core doesn't contradict. Passing makes a row *eligible*. The human decides whether it joins the baseline (Testing rules, rule 5).

The bootstrap tool exists (`runtime/team3Bootstrap.ts`, built in groundwork).

### Order
R3 ran first (done). The rest runs **in parallel** under [Parallel Stage 2](#parallel-stage-2) below: R1, R2, R4, R5 and the relativeToSpy **filter**, each as an on/off test against the frozen V4 baseline. What stays in order: the combining step after every session reports, then the relativeToSpy **new-signal** version on the combined stack, then Stage 3 once.

### Budget: ~30 configs, split by goal
At most **2 values per knob**. Feature rows count. Diagnostic (D) and validation (V) rows don't count, but they still go in the ledger. The same config run twice (runs are deterministic) counts once.

| Goal | Configs | Covers |
|---|---|---|
| R3 costs | 4 (**used**) | `minEdgeBps` 25/35, cost gate 0.5/0.6: A05–A12 |
| R1 liquidity | 3 | `entryZ` 2.5 and 1.5, fade-the-turn (`useTurnEntry`) |
| R2 regime | 2 | SPY/QQQ exclusion (Q2.5), `useVwapRegime` (Q2.7) |
| R2 relativeToSpy filter | 2 | filter at cutoffs 0.5 and 0.7 |
| R4 exits | 2 (+1) | `stopZ` off (Q2.6), partway target; **+1 from the reserve, pre-registered:** scale-out-half runs only if the partway target fails the keep rule |
| R5 portfolio | 2 | `useVolSizing` (`riskPerTradeUsd` 5), crowd split |
| Combining + relativeToSpy new signal | 10 (5 + 5 more, lead 2026-11-23) | one config per winner added, then the new-signal version and its retune |
| Reserve | 5 (1 used by R4-03; 4 unused) | only by a lead decision written in the ledger |
| **Total** | **~30** | |

The combining step judges each step with a size-neutral **"true test"**: net bps/trade must improve, plus bootstrap share ≥ 0.8, halves agree, Core doesn't contradict, and the step's mechanism moves. The net-$ keep rule alone rewards rows that just bet smaller or trade less.

A goal can't borrow from another goal. Unused slots go to the reserve. **Each extra config is another chance to keep something that only worked by luck**, and 26 OOS days can't fully separate real effects from lucky ones. So the paper states the real N, and the luck-only best IS Sharpe at that N (R6 formula: about **5.8 annualized at N = 30, T = 32**; 5.6 at N = 25) is the bar an IS Sharpe is read against.

### Trial ledger
The ledger is [ablation.md](ablation.md). **Every row goes in it**, including diagnostics, features and failed runs. Each row records: ID, R goal, window/dates, universe, config diff vs baseline, VERSION, backtestId, reportable yes/no, net P&L, trades, bps/trade, reversion share, and exit mix (plus win %, payoff, PF, Sharpe, max DD). Never edit a row; supersede it. The paper states the real number of configs tried.

### Out-of-sample ban
- **No OOS day (2026-10-16 → 2026-11-20) is used before Stage 3.** That covers runs, plots, peeks, "just checking" and diagnostics. One OOS look on a feature leaks into every later decision, and then relativeToSpy or any other feature can't be claimed as evidence.
- Stage 3 runs **once**, on the configs frozen and recorded in the ledger before the run. Frozen 2026-11-24: F3 and L2 (primaries), L4, F1, C3, plus V4 as the reference. See [ablation.md](ablation.md), "Stage 3 pre-registration".
- Don't carve a validation set out of the IS days. There are too few to split again. Use the paired bootstrap and the two-halves check instead.

### Mechanism checks (measurable before a row runs)
A row can't run until its mechanism check is in the runner output (`mechanism` in `TEAM3_ROW`, one file per goal in `runtime/team3Metrics/`). Baseline reversion share: **15.5% Core (A03), 17.6% Momentum (A04)**.

| Goal | Mechanism check |
|---|---|
| R3 costs | reversion share (target exits / trades), exit-reason mix, avg gross bps |
| R1 liquidity | reversion share ↑; adverse move over the first 5 bars after entry ↓ |
| R2 SPY/QQQ exclusion | Core's edge before costs moves toward Momentum's (zero-cost twins are D rows) |
| R2 vwapRegime | fewer time-stop exits on trend days (trend day defined in the ledger before the run) |
| R2 relativeToSpy filter | reversion share ↑; β of per-trade P&L to SPY's return over the holding window ↓ |
| R4 stop off | the trades the baseline stopped don't turn into bigger losses |
| R4 partway target / scale-out | win rate ↑, avg win ↓, net holds |
| R5 vol sizing | share of entries where the cap binds (qty < qtyWanted) ↓ |
| R5 crowd split | max drawdown on cluster days ↓ (cluster defined in the ledger before the run) |

## Parallel Stage 2
Decided by the lead on 2026-11-23. It applies to every goal after R3.
- **Frozen baseline:** VERSION 4 defaults, A03 Core / A04 Momentum. The code is VERSION 6; with every switch off it reproduces A03/A04 exactly (ablation V1–V4). Nobody promotes anything.
- **One worktree and branch per goal:** `.claude/worktrees/t3-<goal>` on `team3/<goal>`, branched from `team3/research`. Goals: `r1`, `r2`, `r4`, `r5`, `rspy`. Prompts: [`results/prompts/`](results/prompts/).
- **Each session writes its own ledger**, `results/ledger-<goal>.md`, never `ablation.md`. They're merged into `ablation.md` in the combining step.
- **No VERSION changes and no shared defaults in sessions.** A session writes "VERSION bump needed"; the combining step sets VERSION 7. Config fields go only inside that goal's marked block in `team3ReversalConfig.ts` and `manifest.ts`; new tests go in a new file.
- **Bootstrap per universe:** `team3Bootstrap.ts <rowId>` picks the row's own baseline (Momentum → A04, Core → A03) and refuses mixed universes.
- **Combining step:** merge the branches and set VERSION 7. Then add the keep-rule winners **one at a time, strongest first**. Each addition is one config on both universes, bootstrapped against the stack so far (per universe) and against V4. Stop when the next winner adds nothing. Then run the relativeToSpy new-signal version on the stack and retune. Freeze, log, and run Stage 3 once.
- **The cost of parallel:** sessions can't see how their changes interact. The combining step is where interactions show up.

### Stopping rule: dropped (2026-11-23)
The pre-registered rule ("stop tuning if Momentum's edge before costs is < 10 bps after R3 and the relativeToSpy filter") was **dropped by the lead**. The project's goal is the best config we can justify. The 32 in-sample days are for exploration, not for deciding whether the strategy works; that decision rests on Stage 3. The cost of dropping it is the luck risk named under Budget, which the paper reports.

### S0 diagnostic results (in-sample only)
- Window: IS 2026-09-01 → 2026-10-15. No OOS days used.
- Edge before costs: **−1.1 bps/trade Core, +4.7 Momentum**, against ~14–15 bps round-trip cost.
- Reversion to VWAP: ≈16% of trades on Core (65/419), ≈18% on Momentum (65/370). 75% end on the 30-bar time stop.
- Net: A00 −$37.8k, A00m −$48.4k, A03 −$3.0k, A04 −$1.6k.
- Decision: Momentum is the main universe.
- IS day count: **32** (the docs were right). The runs reported 33 because the engine stamps its final equity point with the wall clock, adding a phantom ~$0 day ([UPSTREAM #10](UPSTREAM.md)). Fixed in `contract/daily.ts`; daily Sharpe and % days profitable were recomputed. R6's Sharpe SE (±2.8 IS) is unchanged.
- 65/65 target exits (Core and Momentum): **a coincidence, not shared output.** Distinct backtestIds, saved configs hold the right symbol lists, orders are disjoint except SPY, and gross target bps differ (+28.4 vs +52.2). Per symbol, SPY (in both universes) has 6 targets in each with an identical exit row, as expected. The other five symbols happen to sum to 59 in both (Core QQQ 13, MSFT 15, GOOGL 11, AMZN 11, AAPL 9; Momentum AMD 15, META 13, MU 12, TSLA 10, NVDA 9). Reruns reproduced A03 and A04 exactly. See [ablation.md](ablation.md#checks).

### What the paper can claim
Firmly: cost and trade-count reductions vs Beginner Reversal, and the direction of each component's effect with CIs. **Not** a significant Sharpe or general profitability. State the number of configs tried.

## Components

Order is the order they run. Entry filters: the first one that says no blocks the trade.

| # | Component | Type | Status | Owner | Write-up | Ablation rows |
|---|---|---|---|---|---|---|
| 1 | VWAP Regime | entry filter | **done, tested** | Alejandro | [vwap-regime](components/vwap-regime.md) | |
| 2 | Volume | entry filter | stub (switch refused) | | [volume](components/volume.md) | |
| 3 | Relative to SPY | entry filter | done (VERSION 7; Rivera PR #78 + Stage 2 rspy) | | [relative-to-spy](components/relative-to-spy.md) | |
| 4 | Vol Sizing | sizing | **done, tested** | Alejandro | [vol-sizing](components/vol-sizing.md) | |
| – | VWAP Stretch | — | dropped: is the baseline entry | | [vwap-stretch](components/vwap-stretch.md) | |
| – | Hold Until Back | — | dropped: is the baseline exit | | [hold-until-back](components/hold-until-back.md) | |
| – | Time of Day | — | dropped: is the baseline session window | | [time-of-day](components/time-of-day.md) | |
| – | Big Move | — | dropped: redundant with `entryZ` | | [big-move](components/big-move.md) | |

Status values: `planned` → `stub` → `done, tested` → `ablated` (has rows) → `kept` / `dropped`.
A `stub` filter's switch is refused by config validation. Flip its `status` to
`"done"` in `filters/index.ts` in the same change that writes the rule and its tests.

## Shared pieces (not switches)
- `contract/`: frame (read), book (own fills and positions), emit (signals), protocol (engine settings).
- `history.ts`: today's session bars and VWAP per symbol.
- `rules.ts`: session window, entry idea, exit reasons.
- `risk.ts`: $ per symbol and $ gross caps.
- `vwap.ts`, `session.ts`, `sizing.ts`.

## Universe
- **Core:** SPY, QQQ, AAPL, MSFT, GOOGL, AMZN
- **Momentum:** SPY, NVDA, AMD, MU, TSLA, META

## What's left
1. [x] **Groundwork**: bootstrap tool, day count, 65/65 check, trial ledger, Testing rules. Per-goal mechanism metrics moved into the Stage 2 sessions (`runtime/team3Metrics/`).
2. [x] **Stage 1:** M1–M7 under VERSION 4; anchors A03 Core, A04 Momentum.
3. [x] **R3** (4 configs, A05–A12): nothing passed the keep rule (the reversion share fell). Lead to decide whether "trades ↓ and bps/trade ↑" counts as R3's mechanism.
4. [ ] **Parallel Stage 2** (R1, R2, R4, R5, relativeToSpy filter), per [Parallel Stage 2](#parallel-stage-2).
5. [ ] **Combining step**, then the relativeToSpy **new-signal** version.
6. [ ] **Stage 3:** freeze the config, log it, then run OOS once.
7. [ ] Teammates: write Volume (rule, tests, write-up, then status `done`).

## Results summary
_(One line per kept/dropped decision, pointing to ablation rows. Filled after testing.)_
