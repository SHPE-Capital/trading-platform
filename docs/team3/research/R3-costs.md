# R3 Costs: whether the edge survives

**Question:** does the expected reversion back to VWAP beat round-trip costs once fills happen at the next bar's open, and at what trade frequency does the strategy stop bleeding?
**Status:** research only. Nothing below is implemented, and no backtest has run, so none of this says the strategy is profitable.

## 1. Mechanism

**Every round trip pays a fixed toll of about 14 to 16 bps, but the gain is only the part of the stretch that actually reverts after our fill, so a trade pays only when `capture × edgeBps` beats that toll.**

- **The toll is fixed per round trip.** It does not depend on how long we hold, how far price is stretched or how much we trade. So costs never make a single trade "too big". What they do is make small trades not worth taking.
- **The gain is smaller than `edgeBps`.** `edgeBps` measures the distance from the signal bar's close to VWAP, which is the best case. Three things shrink it:
  1. **Partial reversion.** Price usually reverts only part of the way. Rif & Utz [7] find that about 31% of an extreme 1-minute move reverses in the next minute, not 100%.
  2. **The target moves toward us.** VWAP is a cumulative average, so volume traded at the stretched price pulls it toward that price while we wait.
  3. **Adverse selection of next-bar-open fills.** The decision uses bar *k*'s close, and the fill comes at bar *k+1*'s open, ±7 bps. Any reversion between that close and the open is already gone. Spreads also tend to widen right after extreme moves [8], which is exactly when we trade. That makes real costs at our entry moments higher than average costs.
- **Net per trade, in bps of entry notional:** `net ≈ capture × edgeBps − 14 − 100/price − gap_in − gap_out`. Here `gap` is the close-to-next-open move against us on each leg.
- **Frequency matters only through selection.** Net P&L = Σ(gross_i − cost_i). Each trade costs the same, so the strategy stops bleeding when the *marginal* trade's expected gross equals the toll. The thresholds (`minEdgeBps`, `entryZ`) set the frequency, and the frequency is just their output.
- **This is the turnover story from the literature.** High-turnover anomalies rarely survive costs [2]. Short-term reversal survives only in large caps, with turnover held down [4]. An intraday strategy has far more turnover than any monthly anomaly, so it survives only by trading rarely, at the extremes.

## 2. Where it lives in our code today

- **Costs per side.** Fills are priced at `ref × (1 ± halfSpread) × (1 ± slippage)`, with `ref` = the next bar's open (`backend/src/core/execution/fillModel.ts:97`, `:194-210`).
  - `halfSpreadBps: 2` comes from `DEFAULT_FILL_MODEL` (`fillModel.ts:99`). It is not in the protocol.
  - `slippageBps: 5` and `commissionPerShare: 0.005` are set in `contract/protocol.ts:29-30`. The engine merges them in at `core/backtest/backtestEngine.ts:127-132`.
  - Commission is charged per filled share (`core/execution/simulatedExecution.ts:757`).
- **Protocol override hook.** `BacktestConfig.fillModel?: Partial<FillModelConfig>` (`backend/src/types/backtest.ts:79`) can vary costs without touching strategy code. That makes any such run a protocol variant, not a reportable row.
- **Edge gate.** `edgeBps = |close − vwap| / close × 1e4` must be at least `minEdgeBps` (`rules.ts:53-54`). The default is 15 (`team3ReversalConfig.ts:84`). `baseline.md:29-30` already states the cost as "about 2 × (5 + 2) bps plus commission".
- **Exits that only pay costs.** Two exits leave without reversion: `time` (`rules.ts:73`, `maxHoldBars` 30, config `:86`) and `close` (flatten window). Each one pays the full toll for a partial gain or none.
- **Size.** `fixedNotionalQty = floor(tradeUsd / price)` (`sizing.ts:24-26`), with `tradeUsd` 5000 (config `:90`).
  - Under this fill model every cost is in bps or per share, so the size does not change the cost per round trip in bps.
  - The volume cap (`fillModel.ts:259`, 10% of the bar's volume) never binds at $5k on these names.
- **Measurement.**
  - Entry meta carries `close` and `edgeBps` (`team3ReversalStrategy.ts:133-138`), and `book.ts` holds the real `entryPrice`. Together they give `gap_in` after the run with no new code.
  - Exit meta `pnlBps` (`team3ReversalStrategy.ts:120`) runs from the entry fill to the signal bar's close. It excludes exit costs and the exit gap.
  - AGENT_GUIDE §3 asks for avg net bps/trade and cost share (`AGENT_GUIDE.md:104,113`).

## 3. Toggle experiments (no new code)

**Cost arithmetic (protocol, $5k per trade).**
- The two sides cost (1.0002)(1.0005) − 1 ≈ 7.00 bps each, so 14.0 bps per round trip.
- Commission per round trip = 2 × $0.005 / price × 1e4 = **100 / price bps**. The share count cancels out.
- The prices below are bands. Read the actual prices for each symbol from the cached window: I could not verify 2026 price levels (unverified).

| Share price | Example symbols (approx., unverified) | Spread + slippage | Commission | **Break-even, full reversion** | Break-even at 60% capture | Break-even at 31% capture |
|---|---|---|---|---|---|---|
| $100 | low-priced names | 14.0 | 1.00 | **15.0 bps** | 25.0 | 48.4 |
| $200 | NVDA, AMZN, AMD, MU | 14.0 | 0.50 | **14.5 bps** | 24.2 | 46.8 |
| $300 | AAPL, GOOGL | 14.0 | 0.33 | **14.3 bps** | 23.9 | 46.2 |
| $500+ | MSFT, TSLA, QQQ, SPY, META | 14.0 | ≤0.20 | **14.1–14.2 bps** | 23.6 | 45.8 |

- **Toll in dollars.** About $7.25 per $5k round trip.
  - 10 trades a day ≈ $73 a day ≈ $18k a year, which is 18% of $100k capital.
  - 40 trades a day ≈ $73k a year.
- **Before the gaps.** These break-evens exclude `gap_in` and `gap_out`. Add them once D1 measures them.
- **Significance.** Suppose the true net is +2 bps and the per-trade standard deviation is about 30 bps (an assumption, unverified). Reaching t = 2 then takes about (2×30/2)² ≈ 900 trades. Filtering too hard also kills significance.

| ID | Config diff vs baseline | Compared to | Metric that should move | Why |
|---|---|---|---|---|
| R3-D1 | none; protocol variant `fillModel: {slippageBps:0, halfSpreadBps:0, commissionPerShare:0}`. **Diagnostic only, not reportable.** | A01 | gross bps/trade; gross − net = cost | Gives the gross edge and the realized `capture = gross/edgeBps`, which feeds the break-even table. Also measure `gap_in` = sign × (open_{k+1} − close_k)/close_k × 1e4 from meta vs fills. |
| R3-D2 | none; protocol variant `fillModel: {referencePrice: "next_close"}`. **Diagnostic only.** | A01 | avg net bps ↓ | Measures what one extra minute of delay costs. A steep drop means the reversion is fast and the next-open delay already gives some of it up (adverse selection). |
| R3-D3 | none; protocol variant `fillModel: {halfSpreadBps:0.5, slippageBps:1}`. **Diagnostic only.** | A01 | net bps ↑ | Tests sensitivity to the conservative protocol: SPY's full spread is about 0.2–0.3 bps [5]. |
| R3-E1 | `minEdgeBps=25` | A01 | trades ↓, avg net bps ↑, cost share ↓ | Puts the gate at the cost of a trade with 60% capture instead of 100%. |
| R3-E2 | `minEdgeBps=35` | R3-E1 | same direction; watch trades for significance | Finds the frontier where the marginal trade's gross equals the toll. Plot net $ against trades for A01, E3, E1 and E2. |
| R3-E3 | `minEdgeBps=0` | A01 | trades ↑, avg net bps ↓ | Shows whether the gate binds at all. On TSLA or MU, 2σ is likely already above 15 bps; on SPY it may not be. Report Core and Momentum separately. |
| R3-E4 | `entryZ=2.5` | A01 and R3-E1 (at a similar trade count) | avg net bps ↑ | Compares selecting by stretch (z, the probability of reverting) with selecting by bps (the unit costs are paid in). |
| R3-E5 | `maxHoldBars=60` | A01 | `time` exits ↓, cost share ↓, max DD ↑? | A time exit pays the full toll for partial gain. Holding longer lets more trades reach the target. |
| R3-E6 | `lastEntryMinutesBeforeClose=45` | A01 | `close` exits ↓, avg net bps ↑, trades ↓ slightly | Entries in the last 30 minutes cannot use the full `maxHoldBars` before the flatten. |
| R3-E7 | `tradeUsd=2500` | A01 | avg bps/trade ≈ unchanged | Sanity check: costs are proportional to size. A change here means the $40k gross cap was rationing entries at $5k (8 slots for 11 symbols). |

Report **gross bps/trade, cost share and the exit-reason mix** on every R3 row. Cost share is undefined when gross P&L ≤ 0.

## 4. Candidate one-line features (not implemented), ranked

**1. A cost floor taken from the protocol, scaled by measured capture**
- One-liner: `idea.edgeBps * CAPTURE >= roundTripCostBps(bar.close)`.
- The cost function lives in `contract/protocol.ts`: `roundTripCostBps = (p) => 2 * (DEFAULT_FILL_MODEL.halfSpreadBps + TEAM3_PROTOCOL.slippageBps) + 2e4 * TEAM3_PROTOCOL.commissionPerShare / p`.
- `CAPTURE` is measured once in R3-D1 on in-sample data, then frozen.
- **Mechanism:** a trade pays only when its expected reversion, not its best-case reversion, beats the toll. Tying the floor to the protocol means changing costs moves the gate too.
- **Evidence:**
  - Reversion is partial: about 31% in the next minute [7].
  - Reversal is driven by temporary imbalances that last under an hour [6].
  - Reversal stays profitable net of costs only with low turnover [2][4].
- **Overfit risk: low.** `CAPTURE` is one measured number, not tuned for P&L. It becomes medium if it is tuned on the result.
- **Extends:** `entryIdea` (`rules.ts:53-54`). **Replaces:** the constant `minEdgeBps`.

**2. An edge adjusted for VWAP drift**
- One-liner: `idea.edgeBps * vwap.sessionBars / (vwap.sessionBars + c.maxHoldBars) >= c.minEdgeBps`.
- **Mechanism:** VWAP is a running average. While we hold, new volume pulls VWAP toward the stretched price, so the target walks toward us. Early in the day VWAP has little history, so the realized gain shrinks most then.
- Bars stand in for volume here. Volume is heavier at the open, so the adjustment is roughly right, not exact.
- **Evidence:** the arithmetic of a cumulative VWAP (its definition, `baseline.md` Math section), plus HKS's under-an-hour imbalances [6]. No paper tests this gate directly (unverified).
- **Overfit risk: low.** It adds no new knob.
- **Extends:** `entryIdea`. It uses `VwapView.sessionBars`, which already sits in entry meta.

**3. A cooldown after a stop**
- One-liner: `if (lastExit(symbol)?.reason === "stop" && barsSince(lastExit) < c.maxHoldBars) return null`.
- **Mechanism:** a stop flags a trend day in that name. Each repeated fade pays 14+ bps into the trend. Cutting turnover where the edge is negative is the cheapest cost saving.
- **Evidence:**
  - A buy/hold spread is the most effective cost mitigation [2].
  - Lower turnover raises net reversal profits [4].
- **Overfit risk: medium.** It needs new per-symbol state (the last exit reason and time) in `book.ts`, so it is not purely existing primitives. It also overlaps with R2's regime filters.
- **Extends:** the entry guard in `team3ReversalStrategy.ts` (step 5).

## 5. Simplify / cut

- **`minEdgeBps=15` is mis-specified.** It equals the break-even (14.1–15.0 bps) only if price reverts all the way, instantly, with no gaps. It is a cost floor with no margin. With any realistic capture below about 95% it admits losing trades.
  - Raise it to about 25–35 for now (E1/E2), or replace it with feature 1.
- **`AGENT_GUIDE.md:104` understates the cost hurdle.** It says avg bps/trade "must beat costs (~5+ bps)". The modeled round trip is about 14+ bps.
  - Also say whether "traded notional" counts one leg or both. Counting both legs halves the bps.
  - Recommend: net bps per round trip, on entry notional.
- **Exit meta `pnlBps` is not net.** It leaves out the exit's ~7 bps, commission and the exit gap. Don't read it as net in analysis.
- **`tradeUsd` is not a cost lever** under this fill model, which has no impact term. Don't tune it to save costs.
  - In reality $5k orders are tiny: impact rises with order size [1], and these orders are far below institutional sizes.
- **Keep the protocol costs.** 7 bps per side is probably far above what a $5k marketable order in these names really pays: SPY's full spread is about 0.2–0.3 bps [5]. That conservatism is useful, though, because a strategy that survives it is robust. Treat D3 as sensitivity only.
- **Cost share is undefined when gross P&L ≤ 0.** Always report gross bps/trade next to it.

## 6. Verdict

- **Costs decide whether this strategy works; they cannot make it profitable.** At `minEdgeBps=15` they likely break it: a trade must capture almost 100% of the stretch just to break even.
  - The literature points to partial reversion: about 31% in the next minute [7].
  - Spreads widen at extremes [8].
  - Reversal stays profitable net of costs only in large caps with low turnover [4].
- **Raising the gate is the lever most likely to keep the edge.** That means a gate of about 25–35 bps, or a cost floor scaled by capture. The cost is fewer trades, with a significance risk below roughly 900 trades.
- **Confidence: medium.**
  - The cost arithmetic is exact for our fill model.
  - The capture fraction and the next-open gap on our symbols are unknown until R3-D1 runs.
  - The literature numbers come from different samples and horizons, not our 1-minute VWAP rule.

## 7. Sources

1. Frazzini, Israel, Moskowitz, "Trading Costs" (2018), SSRN 3229719: https://papers.ssrn.com/abstract=3229719. Secondary summaries report average impact just under 9 bps and median about 6 bps on institutional orders, rising with size (unverified against the PDF). Summary: https://alphaarchitect.com/the-best-research-paper-ever-written-on-trading-costs/
2. Novy-Marx & Velikov, "A Taxonomy of Anomalies and Their Trading Costs", *RFS* 29(1), 2016, 104–147, doi 10.1093/rfs/hhv063: https://www.nber.org/papers/w20721. Findings: a buy/hold spread is the most effective mitigation, and anomalies with under 50% monthly turnover mostly survive costs.
3. Perold, "The Implementation Shortfall: Paper versus Reality", *Journal of Portfolio Management* 14(3), 1988: https://www.proquest.com/docview/195579087. Hasbrouck's notes: https://pages.stern.nyu.edu/~jhasbrou/Teaching/POST%202015%20Fall/classNotes/STPPTradingCosts.pdf. Used for: paper portfolio (fill at the signal bar's close, no costs) vs real fills, including delay cost (D1/D2).
4. de Groot, Huij, Zhou, "Another look at trading costs and short-term reversal profits", *Journal of Banking & Finance* 36(2), 2012, 371–382: https://ideas.repec.org/a/eee/jbfina/v36y2012i2p371-382.html. Findings: 30–50 bps a week net of costs, with costs driven by small caps and turnover.
5. State Street, "SPY Capital Markets Perspective Q2 2024" (issuer-reported): https://ssga.com/library-content/products/fund-docs/etfs/us/insights-investment-ideas/spy-capital-markets-perspective-q2-2024.pdf. SPY's average spread is about $0.015, or 0.27 bps. Q1 2024: about 0.21 bps.
6. Heston, Korajczyk, Sadka, "Intraday Patterns in the Cross-section of Stock Returns", *Journal of Finance* 65(4), 2010: https://arxiv.org/abs/1005.3535. Finding: reversal comes from temporary liquidity imbalances lasting under an hour, and from bid-ask bounce.
7. Rif & Utz, "Short-term stock price reversals after extreme downward price movements", *Quarterly Review of Economics and Finance* 81, 2021, 123–133: https://ideas.repec.org/a/eee/quaeco/v81y2021icp123-133.html. Findings: about 31% of an extreme 1-minute return reverses in the next minute (Nasdaq-100, 2014–2019), with the strongest reversal in the largest and most liquid names.
8. Zawadowski, Andor, Kertész, "Short-term market reaction after extreme price changes of liquid stocks" (2004): https://arxiv.org/abs/cond-mat/0406696. Finding: on the NYSE, spreads widen after extreme moves and wipe out most contrarian profit; on Nasdaq they do not.
