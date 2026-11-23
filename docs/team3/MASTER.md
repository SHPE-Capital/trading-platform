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
**The rules for iterating are in [Iteration rules](#iteration-rules) below. They override any older wording in research/.**

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
Change **one thing per row**, compared against the *current* baseline. The change becomes part of the baseline only if all four hold:
1. Net P&L improves on **Momentum** (IS).
2. The row's **mechanism check** moves in the predicted direction (see the table below). For example, the reversion share rises above 18%.
3. **Core doesn't contradict it** (same sign of effect, or flat).
4. The **paired day-bootstrap** (row minus baseline, same IS days) beats the baseline in most resamples, *and* the effect holds in **both halves** of the IS window.

Rule 4 depends on the bootstrap tool, which doesn't exist yet. It's built in the groundwork task (see [What's left](#whats-left)). **No row can be kept before that tool exists.**

### Order
**R3 → R1 → R2 → R5 → R4**, set by the S0 diagnostics. Within each R, the setting rows and that goal's feature run together, next to each other.

### Budget: ~20 configs, split by goal
At most **2 values per knob**. Feature rows count. Diagnostic (D) and validation (V) rows don't count, but they still go in the ledger.

| Goal | Configs | Covers |
|---|---|---|
| R3 costs | 4 | `minEdgeBps` (2 values), cost-aware edge |
| R1 liquidity | 3 | `entryZ` (2 values), fade-the-turn |
| R2 relativeToSpy | 3 | filter at 2 cutoffs, + new-signal version only if the filter is kept |
| R2 other | 2 | `useVwapRegime`, SPY/QQQ exclusion |
| R5 portfolio | 3 | `useVolSizing` (`riskPerTradeUsd=5`), crowd split, interaction |
| R4 exits | 2 | `stopZ` off, partway target |
| Reserve | 3 | only by a lead decision written in the ledger |
| **Total** | **20** | |

A goal can't borrow from the next goal. Unused slots go to the reserve. *(The split is proposed; the lead confirms or edits it before R3 starts.)*

### Trial ledger
The ledger is [ablation.md](ablation.md). **Every row goes in it**, including diagnostics, features and failed runs. Each row records: ID, R goal, window/dates, universe, config diff vs baseline, VERSION, backtestId, reportable yes/no, net P&L, trades, bps/trade, reversion share, and exit mix (plus win %, payoff, PF, Sharpe, max DD). Never edit a row; supersede it. The paper states the real number of configs tried.

### Out-of-sample ban
- **No OOS day (2026-10-16 → 2026-11-13) is used before Stage 3.** That covers runs, plots, peeks, "just checking" and diagnostics. One OOS look on a feature leaks into every later decision, and then relativeToSpy or any other feature can't be claimed as evidence.
- Stage 3 runs **once**, on the final stacked config, frozen and recorded in the ledger before the run.
- Don't carve a validation set out of the IS days. There are too few to split again. Use the paired bootstrap and the two-halves check instead.

### Mechanism checks (measurable before a row runs)
A row can't run until its mechanism check is in the runner output.

| Goal | Mechanism check | Measurable now? |
|---|---|---|
| R3 costs, R1 liquidity | reversion share (target exits / trades), exit-reason mix, avg gross bps | **yes** |
| R2 relativeToSpy | trade P&L moves less with SPY: β of per-trade P&L to SPY's return over the same holding window | **no: add the metric in groundwork** |
| R2 vwapRegime | worst-day P&L | yes (per-day P&L) |
| R5 crowd split | max drawdown, and worst same-minute cluster loss | **no: add the metric in groundwork** |
| R5 vol sizing | P&L std across symbols | yes |
| R4 exits | exit mix, P&L tails | yes |

### Stopping rule (pre-registered 2026-11-23)
After the **R3 budget and the relativeToSpy filter rows** are done: if Momentum's **edge before costs** is still well short of the ~14–15 bps round-trip cost (**< 10 bps/trade**), **stop tuning.** Don't spend the reserve chasing it. Freeze the current config, run Stage 3 once, and write the paper as *"why this doesn't beat costs, and what each part contributes"*: each component's effect with its CI, plus the cost decomposition. That's an honest, reportable result. *(The 10 bps threshold is proposed; the lead confirms it before R3.)*

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
| 3 | Relative to SPY | entry filter | stub (switch refused) | | [relative-to-spy](components/relative-to-spy.md) | |
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
In order. Each step gates the next.
1. [ ] **Groundwork (before R3):**
   - [ ] Paired day-bootstrap tool (row minus baseline on the same days, from the saved `equity_curve`), plus the two-halves check. The keep rule depends on it.
   - [ ] Runner metric: β of per-trade P&L to SPY (for relativeToSpy).
   - [ ] Runner metric: max DD and worst same-minute cluster loss (for crowd split).
   - [ ] Fix the IS day count (32 vs 33), and check the 65/65 target exits.
   - [ ] Lead confirms the budget split and the stopping threshold above.
2. [ ] **Stage 1:** fix M1–M7 under a new VERSION, then rerun the anchor A01 (Momentum + Core, IS).
3. [ ] **R3** (4 configs), then apply the **stopping rule** check after R3 + the relativeToSpy filter.
4. [ ] **R1** (3).
5. [ ] **R2:** lock the [relativeToSpy spec](components/relative-to-spy.md#spec-locked-before-the-batch) first, then run the filter, then the new signal only if the filter is kept (3), then the other R2 rows (2).
6. [ ] **R5** (3), then **R4** (2).
7. [ ] **Stage 3:** freeze the config, log it, then run OOS once.
8. [ ] Teammates: write Volume (rule, tests, write-up, then status `done`).

## Results summary
_(One line per kept/dropped decision, pointing to ablation rows. Filled after testing.)_
