# R5 Portfolio: how bets combine

**Category:** R5 · **Strategy:** Team 3 Reversal VERSION 3 · **Status:** research proposal (nothing implemented, no backtest run yet) · **Written:** 2026-11-21

## 1. Mechanism

**When several symbols stretch from VWAP in the same minute, most of the stretch is one market move, so fading all of them is one market bet placed many times, not many independent bets.**

- Each 1-minute return is roughly *beta x market move + the stock's own move*. A market-wide selloff pushes every symbol's z below -2 together, and the baseline buys all of them. The book is then one leveraged long-the-market position.
- **Effective number of bets.** With N equal bets and average pairwise correlation ρ, the book's variance equals that of `N_eff = N / (1 + (N-1)ρ)` independent bets. For example, N = 6 and ρ = 0.6 (an illustrative number, not measured) gives N_eff = 1.5. So six positions carry about the risk of 1.5 bets. Meucci (2009) states the general version of this idea. [S7]
- **Correlation rises when it hurts.** Correlations with the market are higher on the downside than on the upside (Ang & Chen 2002, US portfolios [S9]; Longin & Solnik 2001, international indices, monthly [S10]). Clustering is therefore worst on exactly the trend days when `stopZ` fires on every name at once.
- **Which part of the stretch comes back.** Short-term reversal pays mostly as a reward for supplying liquidity (Nagel 2012 [S1]). The part of a return not explained by news reverses more (Da, Liu & Schaumburg 2014 [S2]). Industry-portfolio reversal earns little except when VIX is high [S1]. At the index level, the S&P 500 ETF shows *momentum* from the first half-hour into the last half-hour (Gao et al. 2018 [S11]). Together these say fading the market component is the weakest part of the trade.
- **Equal-dollar vs equal-risk.** Equal-risk sizing (inverse volatility, risk parity [S8]) evens out how much each name can hurt us. But our edge is `edge_bps = |z| x σ_VWAP / price`, while costs are a fixed ~14 bps round trip. Calm names therefore clear costs by the thinnest margin, and equal-risk sizing moves dollars *toward* those thin-margin trades. Vol management also has a mixed out-of-sample record (Cederburg et al. 2020 [S5]), and its alpha comes mainly from trend exposure, which a reversal strategy does not have (Hood & Raughtigan 2024 [S4]).

## 2. Where it lives in our code today

- **Sizing:** `team3ReversalStrategy.ts:101` picks `volTargetQty(earlier, bar, riskPerTradeUsd)` when `useVolSizing` is on, otherwise `fixedNotionalQty(tradeUsd, price)` (`sizing.ts:24`, `sizing.ts:29-38`). Knobs: `tradeUsd` 5000 (`team3ReversalConfig.ts:90`), `riskPerTradeUsd` 25 (`:103`), `useVolSizing` false (`:97`).
- **Caps:** `grossUsd(book.exposures(), frame.priceOf)` (`team3ReversalStrategy.ts:102`, `risk.ts:37`) then `capQty` (`team3ReversalStrategy.ts:103`, `risk.ts:29`). Knobs: `maxPositionSizeUsd` 10000 (`team3ReversalConfig.ts:79`), `maxGrossUsd` 40000 (`:91`). The engine ceilings above them are 15k / 60k (`contract/protocol.ts:33-34`, enforced at `team3ReversalConfig.ts:150-151`).
- **Pending counted:** `book.exposures()` yields `max(|held|, |held+pending|)` per symbol (`contract/book.ts:85-90`), so same-minute entries see each other. It is **unsigned**, though. No primitive gives *net* (signed) exposure that includes pending orders.
- **Cross-section:** history ingests every symbol's same-minute bar before any decision (`team3ReversalStrategy.ts:75`, CONTRACT G2 `CONTRACT.md:30`). So `this.history.vwap(s, ...)` gives every symbol's z for this minute, whatever the evaluation order. `frame.latest` / `frame.priceOf` are at `contract/frame.ts:26-28`.
- **Evaluation order:** alphabetical (`CONTRACT.md:30`). Core = AAPL, AMZN, GOOGL, MSFT, QQQ, SPY. Momentum = AMD, META, MU, NVDA, SPY, TSLA. When the gross cap binds, the index ETFs (Core) and SPY and TSLA (Momentum) lose the room.
- **Universe and benchmark:** groups are in `docs/team3/AGENT_GUIDE.md:66`. The backtest benchmark is a separate `benchmarkCurve` (`backend/src/types/backtest.ts:96`), so SPY does **not** have to be traded to be the benchmark. Only `useRelativeToSpy` forces `benchmarkSymbol` into `symbols` (`team3ReversalConfig.ts:162-165`), and that also means it gets traded.
- **Audit trail:** each entry's meta records `qtyWanted` and `grossUsdBefore` (`team3ReversalStrategy.ts:110`), so you can count how often a cap trimmed an entry without touching code.

## 3. Toggle experiments (no new code)

Protocol: as in AGENT_GUIDE §2. A01 = baseline for the group. Every row changes one thing versus its "Compared to" row.

| ID | Config diff vs baseline | Compared to | Metric that should move (direction) | Why |
|---|---|---|---|---|
| R5-E1 | `symbols=Momentum` | A01 Core | avg bps/trade ↑, worst day ↓ (worse), Sharpe ? | Higher σ gives more bps edge over fixed costs, but more trend days and stop clusters |
| R5-E2 | `symbols=[AAPL,MSFT,GOOGL,AMZN]` (Core minus SPY/QQQ) | A01 Core | avg bps/trade ↑, daily P&L corr with SPY ↓, worst day ↑ | SPY/QQQ fades are pure market bets, and near-duplicates of each other |
| R5-E3 | `symbols=[SPY,QQQ]` | A01 Core | trades ↓, avg bps/trade ≤ 0 expected | Tests whether index-level fades pay at all (intraday index momentum [S11]) |
| R5-E4 | `useVolSizing=true` (riskPerTradeUsd 25) | A01 | share of entries with qty < qtyWanted ≈ high; P&L std across symbols **not** ↓ | Prediction: at 25 nearly every symbol hits the $10k cap (see §5), so this row tests "2x size + gross rationing", not equal-risk |
| R5-E5 | `useVolSizing=true, riskPerTradeUsd=5` | R5-E4 | P&L std across symbols ↓, max DD ↓, avg bps/trade ↓ or flat | True equal-risk mostly inside caps. Shows whether tilting to calm names pays after costs |
| R5-E6 | `maxGrossUsd=15000` | A01 | trades per symbol skewed to early letters, worst day ↑, net exposure at peak ↓ | Forces the cap to bind (3 positions). Measures both the alphabet bias and what limiting a cluster is worth |
| R5-E7 | `useVolSizing=true, maxGrossUsd=60000` | R5-E4 | late-letter symbols' trades ↑, worst day ↓ (worse) | 6 x $10k = $60k, so rationing disappears. Shows what the gross cap actually protects |
| R5-E8 | `symbols=` all 11 (default list) | A01 Core and A01 Momentum | worst day ↓, P&L corr with SPY ↑, QQQ/SPY/TSLA trade counts ↓ | 11 x $5k > $40k, so the cap binds and rations alphabetically |
| R5-E9 | all 11, `tradeUsd=3500` | R5-E8 | per-symbol trade counts flatten, P&L scales ~0.7x | 11 x $3.5k = $38.5k < cap: same universe, no rationing |

**Optional metrics to record in these rows:**
- P&L std across symbols
- Net exposure at peak: max over minutes of |Σ signed qty x price|, from fills
- Worst day P&L
- Correlation of daily P&L with SPY's daily return (the hidden beta)
- Entries per minute (how large clusters get)
- Share of entries trimmed by a cap (from `qtyWanted`)
- Trades per symbol vs alphabetical rank

## 4. Candidate one-line features (not implemented), ranked

1. **Crowd split: one cluster, one bet budget.**
   `const crowd = c.symbols.filter((s) => { const z = this.history.vwap(s, c.vwapWindowBars)?.z ?? 0; return idea.side === "buy" ? z <= -c.entryZ : z >= c.entryZ; }).length; want = Math.floor(want / Math.max(1, crowd));`
   - Mechanism: k symbols stretched the same way at once are about one market bet (§1, N_eff), so they share one trade's dollars.
   - Evidence: downside correlation asymmetry [S9][S10]; market and industry parts reverse weakly [S1][S2][S11].
   - Overfit risk: **low**. No new knob, and it is order-independent, which also removes the alphabet bias in clustered minutes.
   - Caveat: Nagel finds reversal pays most in turmoil [S1], so this could also shrink the best trades. That is the thing the ablation decides.
   - Extends `sizing.ts` (a multiplier after either sizer). It takes over the job `maxGrossUsd` does badly.
2. **Net-exposure cap.**
   `if (Math.sign(net) === sgn && Math.abs(net + sgn * want * bar.close) > c.maxGrossUsd / 2) return this.skip("net cap");`
   where `net = Σ signed qty x priceOf`.
   - Mechanism: limit the direction of the book (market beta), not just its size.
   - Evidence: [S7][S9].
   - Overfit risk: **med**. The threshold (gross/2) is a choice.
   - Needs a signed `book.netExposures()` including pending (`book.ts:85-90` is unsigned). Without it, `book.holding(s)?.qty` misses same-minute pending orders, which is exactly the selloff case.
   - Extends `risk.ts`.
3. **Watch-only benchmark.**
   `if (symbol === c.benchmarkSymbol && c.symbols.length > 1) return this.skip("benchmark is watch-only");`
   (behind a new switch)
   - Mechanism: fading SPY is a naked market bet that every other position already carries.
   - Evidence: [S1][S11].
   - Overfit risk: **low**.
   - Lets `useRelativeToSpy` read SPY without trading it. Extends the universe/entry step.
4. **Risk-to-stop sizing.**
   `want = Math.floor(c.riskPerTradeUsd / (Math.max(0.5, c.stopZ - Math.abs(idea.z)) * vwap.sigma));`
   - Mechanism: "equal risk" should mean equal dollars lost if the stop hits. The stop is set in VWAP-sigma units, not 1-minute return std.
   - Evidence: risk parity logic [S8]. Applying it to the stop is our own adaptation (unverified in the literature).
   - Overfit risk: **med**. It needs a retuned `riskPerTradeUsd` and a floor on stop distance.
   - Replaces `volTargetQty`.
5. **Edge-priority rationing** (largest |z| gets the room when the cap binds). Ranked last: it needs a cross-symbol ranking and is not one line. Fix the bias instead with E9-style caps that never bind, or with candidate 1.

## 5. Simplify / cut

- **Both caps never bind in the protocol's main rows.** With fixed sizing and 6 symbols, at most 6 x $5k = $30k is open, below the $40k gross cap. One position per symbol with no adding means the $10k per-symbol cap never binds at $5k either. They are safety rails. Don't credit or blame them for any fixed-sizing result.
- **`riskPerTradeUsd=25` is likely mis-set.** Back-of-envelope (annual vol / √(252x390), unverified on our data): SPY ≈ 5 bps per minute gives 25/0.0005 ≈ $50k; TSLA ≈ 19 bps gives ≈ $13k. Both get capped to $10k, so vol sizing ≈ "flat $10k". That sizing then hits the gross cap at 4 positions and rations alphabetically. A value of about $5 keeps most names inside the cap (check with R5-E4/E5 and `qtyWanted`).
- **The gross cap is the wrong instrument for the hidden bet.** Six longs at $30k and a hedged 3 long / 3 short at $30k pass it equally. Net exposure is what carries the market risk (candidate 2), or cluster size (candidate 1).
- **SPY and QQQ together in Core are near-duplicates** (high correlation; exact figure unverified). SPY in Momentum "for benchmarks" isn't needed, since the benchmark comes from `benchmarkCurve`.
- **Minor:** `capQty`'s `symbolUsd` is always passed as 0 (`team3ReversalStrategy.ts:103`). That is correct because entries only happen when flat, but the input is vestigial.
- **Flag, not cut:** vol sizing's σ window includes the stretch bar, so size shrinks exactly when stretched. That is the opposite of Nagel's "reversal pays more when vol is high" [S1].

## 6. Verdict

- **Keeps, does not make.** Portfolio construction creates no edge. It sets how many independent bets we really hold and how much the worst (trend/selloff) day costs.
- **Could break** profitability through clustered same-direction stops if left as is. The current caps don't limit direction, and in 6-symbol rows they don't bind at all.
- **Equal-dollar is a sound baseline.** Equal-risk is untested in practice because the default knob makes it cap-bound.
- **The alphabet bias is real but only appears when the cap binds** (E4, E6, E8). Record it, and prefer fixes that make it irrelevant (E9 caps, candidate 1) over a ranking engine.
- **Confidence:** high on the code arithmetic (inert caps, cap-bound vol sizing, alphabetical rationing). Low on the P&L direction: no backtest yet, and the literature is on daily/weekly/monthly reversal, not 1-minute VWAP fades.

## 7. Sources

1. Nagel, S. (2012). Evaporating Liquidity. *Review of Financial Studies* 25(7), 2005–2039. https://www.nber.org/papers/w17653
2. Da, Z., Liu, Q., Schaumburg, E. (2014). A Closer Look at the Short-Term Return Reversal. *Management Science* 60(3), 658–674. https://econpapers.repec.org/RePEc:inm:ormnsc:v:60:y:2014:i:3:p:658-674 (working paper: https://www.newyorkfed.org/research/staff_reports/sr513.html)
3. Moreira, A., Muir, T. (2017). Volatility-Managed Portfolios. *Journal of Finance* 72(4), 1611–1644. https://www.nber.org/papers/w22208
4. Hood, B., Raughtigan, C. (2024). Volatility Targeting Is Trendy. SSRN 4773781 (ID taken from our vol-sizing doc; the SSRN page was not reachable, so the ID is unverified). Secondary summary: https://mrzepczynski.blogspot.com/2024/07/volatility-targetting-is-trend.html
5. Cederburg, S., O'Doherty, M., Wang, F., Yan, X. (2020). On the Performance of Volatility-Managed Portfolios. *Journal of Financial Economics* 138(1), 95–117. https://econpapers.repec.org/RePEc:eee:jfinec:v:138:y:2020:i:1:p:95-117
6. Harvey, C. et al. (2018). The Impact of Volatility Targeting. *Journal of Portfolio Management*. https://people.duke.edu/~charvey/Research/Published_Papers/P135_The_impact_of.pdf
7. Meucci, A. (2009). Managing Diversification. *Risk*, 74–79 (effective number of bets). https://risk.net/node/1500233
8. Maillard, S., Roncalli, T., Teïletche, J. (2010). The Properties of Equally Weighted Risk Contribution Portfolios. *Journal of Portfolio Management* 36(4). https://econbiz.de/Record/the-properties-of-equally-weighted-risk-contribution-portfolios-maillard-s%C3%A9bastien/10008445483
9. Ang, A., Chen, J. (2002). Asymmetric Correlations of Equity Portfolios. *Journal of Financial Economics* 63, 443–494. https://www.nber.org/papers/w8643
10. Longin, F., Solnik, B. (2001). Extreme Correlation of International Equity Markets. *Journal of Finance* 56(2), 649–676. https://econpapers.repec.org/RePEc:bla:jfinan:v:56:y:2001:i:2:p:649-676
11. Gao, L., Han, Y., Li, S. Z., Zhou, G. (2018). Market Intraday Momentum. *Journal of Financial Economics* 129(2), 394–414. https://econpapers.repec.org/RePEc:eee:jfinec:v:129:y:2018:i:2:p:394-414
12. Lo, A., MacKinlay, A. C. (1990). When Are Contrarian Profits Due to Stock Market Overreaction? *Review of Financial Studies* 3(2), 175–205 (much of portfolio "reversal" profit is cross-stock lead-lag, not own-reversal). https://www.nber.org/papers/w2977
13. Choueifaty, Y., Coignard, Y. (2008). Toward Maximum Diversification. *Journal of Portfolio Management* 35(1), 40–51 (diversification ratio; citation from secondary sources). https://www.risk.net/journal-of-investment-strategies/2255764/properties-of-the-most-diversified-portfolio (follow-up paper)
