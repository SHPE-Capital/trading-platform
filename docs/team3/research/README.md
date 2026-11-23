# Team 3 Research: Shallow code, deep reasons

> **Shallow code, deep reasons.** Every rule is one line built from primitives we
> already have, and it earns its place only by naming the market mechanism that
> makes it pay. That keeps the strategy simple to write, clear to explain, and open
> to extension wherever the mechanism holds.

Simple code is not a beginner strategy. The depth is in *why* each line works.
Each category below is one **mechanism**, not one indicator. A feature belongs
to the category whose mechanism it relies on.

**Status (2026-11-23):** the S0 diagnostics have run (IS only). See
[MASTER.md S0 results](../MASTER.md#s0-diagnostic-results-in-sample-only).
Every claim here is still a hypothesis, paired with the row that will test it.

> **Rules for iterating (budget, keep rule, ledger, OOS ban, stopping rule) live in
> [MASTER.md, Iteration rules](../MASTER.md#iteration-rules).** Where this file disagrees with them, MASTER wins.
> The main changes: about 20 configs split by goal (it used to be 10), Momentum is the main universe and Core is the control (no longer "tune on Core"), and no OOS day before Stage 3.

## The categories

| # | Mechanism | One-line takeaway | File |
|---|---|---|---|
| R1 | **Liquidity: why a stretch snaps back** | Stretches that are forced trading revert; stretches caused by news don't. The fee for absorbing that trading is smallest in mega-caps, and those are what we trade. | [R1-liquidity](R1-liquidity.md) |
| R2 | **Regime: when reversion works** | Trend days and market-wide moves kill fades. Moves specific to one stock revert; the index's own move tends to continue. | [R2-regime](R2-regime.md) |
| R3 | **Costs: whether the edge survives** | Break-even is about **14–15 bps** per round trip even if price reverts all the way, about 25 bps at 60% capture. Costs decide the result but cannot create an edge. | [R3-costs](R3-costs.md) |
| R4 | **Exit geometry: how much of the reversion we capture** | On a random walk no exit rule changes expected gross P&L. Exits manage the tails and the costs, and the edge has to come from entry. | [R4-exit-geometry](R4-exit-geometry.md) |
| R5 | **Portfolio: how bets combine** | Several symbols stretching in the same minute is one market bet repeated. Vol sizing at today's default isn't really equal-risk. | [R5-portfolio](R5-portfolio.md) |
| R6 | **Evidence: whether a result is real** | 32 in-sample / 21 out-of-sample days give a Sharpe standard error of about ±2.8 / ±3.5. Claim effects and costs, not a significant Sharpe. At most 2 values per knob, about 20 configs in total, split by goal ([MASTER](../MASTER.md#budget-20-configs-split-by-goal)). | [R6-evidence](R6-evidence.md) |

## What the agents agreed on (independently)

1. **`minEdgeBps = 15` is about the round-trip cost (14–15 bps)** (R1, R2, R3, R4). It breaks even only if price comes all the way back to VWAP, and we fill a bar late. This is the most likely reason the baseline would lose.
2. **Fading SPY and QQQ is a pure market bet** (R1, R2, R5). Index ETFs have no stock-specific component, and the index's own intraday move tends to continue. SPY can stay the benchmark without being traded.
3. **Exits and sizing *keep* or *break* profit; only entry selection *makes* it** (R2, R4, R5). Spend the knob budget on entry.
4. **Same-minute cross-symbol stretches are correlated risk** (R2, R5). They need either a residual (stock minus SPY) view or a size split.

## Mis-specifications found (fix before tuning; these are corrections, not tuning)

| # | Found by | Issue | Proposed fix | Type |
|---|---|---|---|---|
| M1 | R4 | Nothing stops an entry with \|z\| already ≥ `stopZ`. Our own test entered at z ≈ 9.6 against a 3.5 stop, so it is stopped on the next bar unless price reverts within a minute. | `rules.ts` `entryIdea`: add `&& Math.abs(vwap.z) < c.stopZ` to `stretched` | code, VERSION bump |
| M2 | R5 | `riskPerTradeUsd = 25` sizes nearly every symbol past the $10k cap (a typical 1-minute σ of ~0.05% gives ~$50k), so vol sizing becomes "flat $10k, alphabetical rationing". | default about 5 (test row R5-E5) | config default |
| M3 | R3 | `AGENT_GUIDE.md` §3 says avg bps/trade must beat "~5+ bps", but the modeled round trip is about 14–15. | update the guide | doc |
| M4 | R6 | The guide's Sharpe definition (daily mean/std × √252) doesn't match the engine's (`performanceAnalytics.ts`); the engine may also leave out the first day's P&L. | define the paper's Sharpe and compute it from the saved equity curve | doc + analysis |
| M5 | R3 | Exit meta `pnlBps` is gross (no exit costs), not net. | label it gross in meta/docs, or add a net field | doc / code |
| M6 | R1, R2, R5 | Citations **SSRN 6438039** (baseline, vwap-regime, vwap-stretch docs) and **SSRN 4773781** (vol sizing) could not be verified. | confirm or replace before the paper | doc |
| M7 | R2 (derivation) | On a steady linear trend z settles at √3 ≈ 1.73 (checked). So `entryZ = 2` already blocks steady trends, entries happen only on *accelerations*, and `stopZ = 3.5` is rarely reached there: the 30-bar time stop does the protecting. | explain it in the paper; it is why the regime filter may add little (test R2-E1) | insight |

## The experiment queue (merged, deduplicated, cheapest first)

The budget in [MASTER](../MASTER.md#iteration-rules) applies: **about 20 configs, split by goal**, all logged in the trial ledger. Momentum is the main universe and Core is the control (same config on both). In-sample only. Diagnostics (D) and validation (V) rows are not tuning, but they are still logged.

**Stage 0: sanity and free analysis (run once the runner exists)**
| Queue | Row | Source | Run | What it decides |
|---|---|---|---|---|
| Q0.1 | V | R6-E2 | `entryZ=50, stopZ=60` → must be exactly $0 | the engine creates no P&L from nothing |
| Q0.2 | A00 | R6-E1 | `beginner_reversal`, Core + Momentum, **IS only** (its OOS run waits for Stage 3) | the reference row |
| Q0.3 | A01 | — | the baseline (after M1, M2), Core + Momentum, IS | the anchor for every comparison |
| Q0.4 | D | R3-D1 | A01 with a zero-cost fill model (**diagnostic only, not reportable**) | gross edge, **capture fraction**, close→next-open gap. If gross < ~15 bps, no threshold can save the baseline (R1-E2) |
| Q0.5 | — | R2, R4, R1-E8, R6-E8 | **no new run**, from A01's ledger and meta: bps by `vwapCrossings` bucket; median `barsHeld` of `target` exits (half-life); exit-reason mix; per-symbol and per-day P&L | which Stage 2 rows are worth spending budget on |

**Stage 1: corrections (M1–M7)**: done in code and docs before Stage 2, under a new VERSION.

**Stage 2: the tuning budget (the per-goal split in MASTER, Momentum IS with Core as control, one change at a time vs the current baseline, run in the order R3 → R1 → R2 → R5 → R4)**
| Queue | Row | Source | Change | Expect |
|---|---|---|---|---|
| Q2.1 | A02 | R3-E1 / R1-E1 | `minEdgeBps=25` | trades ↓, avg net bps ↑, cost share ↓ |
| Q2.2 | A03 | R3-E2 | `minEdgeBps=35` | the frontier: plot net $ against trades |
| Q2.3 | A04 | R1-E3 / R3-E4 | `entryZ=2.5` | win % ↑ (temporary pressure) or stop share ↑ (news): tells which wins |
| Q2.4 | A05 | R6-E6 | `entryZ=1.5` | the neighbour / plateau check |
| Q2.5 | A06 | R2-E6 / R5-E2 | `symbols=[AAPL,MSFT,GOOGL,AMZN]` | avg bps ↑, correlation with SPY ↓ (universe row: flag it) |
| Q2.6 | A07 | R4-E2 | `stopZ=100` (stop off) | does the stop earn its place? If net holds and DD barely moves, cut it |
| Q2.7–2.9 | A08–A10 | R6-E7 (R2-E1, R5-E5) | 2×2: `useVwapRegime` × `useVolSizing` (`riskPerTradeUsd=5`) | regime: worst day ↑; vol: P&L std across symbols ↓; and their interaction |

The final config = the best of Q2.1–Q2.4 on one knob each, plus any Q2.5–Q2.9 change whose paired bootstrap CI excludes 0.

**Stage 3: validation (the final config, frozen)**
| Queue | Row | Source | Pass criterion |
|---|---|---|---|
| Q3.1 | V | R6-E3 | frozen OOS rerun, once: same sign of net P&L, OOS avg bps > 0 |
| Q3.2 | V | R6-E4 | the final config, unchanged, on Core (the control): reports whether the edge transfers |
| Q3.3 | V | R6-E5 | 4 sub-periods: avg bps > 0 in most |
| Q3.4 | V | R6-E8 | net P&L minus the best day > 0; no single symbol carries it |

**Backlog (explanatory rows, only if time allows; each is still one row):** R2-E2/E3 (crossing dose / whole-day window), R1-E6 / R2-E4 (`skipOpenMinutes=30`), R2-E5 / R3-E6 / R4-E8 (later entry cutoff), R4-E1 / E3 grids (stop / hold), R5-E6–E9 (cap binding, all 11 symbols), R3-D2 / D3 (fill-delay and cost-sensitivity diagnostics).

## Candidate one-line features (proposals, not implemented), ranked

Each would follow the AGENT_GUIDE checklist (switch, `status: "stub"` until it has a test, then a doc and a VERSION bump).

| Rank | Feature | One-liner (sketch) | Mechanism | Category | Extends |
|---|---|---|---|---|---|
| 1 | **Don't enter past the stop** | `stretched && Math.abs(vwap.z) < c.stopZ` | the real stop distance is `stopZ − z₀`, not `stopZ − entryZ` | R4 | baseline entry (fix M1) |
| 2 | **Cost-aware edge** | `idea.edgeBps * CAPTURE >= roundTripCostBps(bar.close)` | the gate must beat the toll at the *measured* capture | R3 | replaces `minEdgeBps` |
| 3 | **Residual stretch** | `Math.abs(ret(stock) - ret(SPY)) >= 0.5 * Math.abs(ret(stock))` over `lookbackBars` | only the stock-specific part reverts | R2 | fills the `relativeToSpy` stub |
| 4 | **Fade the turn, not the push** | side from `vwap.z`, and require `bar.close` to move *toward* VWAP vs `prev.close` | enter after the order imbalance has ended | R1 | baseline entry |
| 5 | **Crowd split** | `want / count(symbols stretched past entryZ on the same side this minute)` | a cluster is one market bet; also removes alphabetical rationing | R5 | sizing |
| 6 | **Partway target** | `short ? z <= c.exitZ : z >= -c.exitZ`, paired with an edge gate measured to `exitZ` | take the most likely part of the reversion | R4 | baseline exit |

**Evaluation tool (R6):** a paired day-bootstrap CI on daily P&L (row minus its "Compared to" row, same days), rebuilt from the saved `equity_curve`. It needs no engine change.

## What the paper can honestly claim (R6)

- **Firmly:** cost and trade-count reductions versus Beginner Reversal; the *direction* of each component's effect, with CIs, where IS, OOS and sub-periods agree.
- **Not:** a statistically significant Sharpe (on OOS that would need a Sharpe of about 5.8), or profitability in general. State the number of configs tried.
