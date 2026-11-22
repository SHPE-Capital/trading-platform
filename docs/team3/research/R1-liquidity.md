# R1 Liquidity: why a stretch snaps back

**Category owner:** research agent R1 · **Baseline:** VERSION 3 · **Status:** proposals only, nothing implemented, no backtest run yet.

## 1. Mechanism

**A stretch from VWAP snaps back when it was caused by someone paying for immediacy (temporary price pressure). It stays when it was caused by new information.**

- **Liquidity (reverts).** An impatient trader sends a large order. Market makers and other liquidity providers absorb it, but they take inventory risk, so they only buy below (or sell above) the "fair" price. That discount is their fee for immediacy (Grossman–Miller 1988 [1]; inventory model in Hendershott–Menkveld 2014 [2]). Once the order is done, the providers unload their inventory and the price drifts back. **Fading the stretch means we are the liquidity provider, collecting that fee.** Nagel 2012 [3] reads short-term reversal returns as exactly this fee.
- **Information (persists).** If the move comes from news or informed flow, the new price is the fair price. Nothing pulls it back. Fading it loses until the stop or time exit fires. Kyle 1985 [4]: an informed trader trades gradually and their information is fully in the price by the end.
- **How to tell them apart (the testable part):**
  - *Volume.* In Campbell–Grossman–Wang 1993 [5], large stocks' price changes on high volume reverse more (liquidity). Llorente et al. 2002 [6] find the sign flips for stocks with a lot of informed trading: there, high-volume moves continue. **So volume alone does not say "news".** It depends on how much private information the stock carries.
  - *News vs no news.* Extreme moves with no headline reverse. Moves with news drift (Chan 2003 [7], monthly horizon). Returns not explained by fundamentals reverse about 4× more strongly (Da–Liu–Schaumburg 2014 [8]).
  - *Persistence of flow.* Order imbalances are highly persistent and predict returns within the day, for 5–60 minutes (Chordia–Roll–Subrahmanyam 2005 [9]). While one-sided pressure is still arriving, the price tends to keep going *before* it reverts.
  - *Who.* Reversals are largest in illiquid stocks and **smallest in the mega-caps and ETFs we trade**. In those names, contrarian profits are smaller than likely transaction costs (Avramov–Chordia–Goyal 2006 [10]). Intraday reversals in S&P futures exist, but costs sharply reduce them (Grant–Wolf–Yu 2005 [11]).
- **Engineer's takeaway:** our edge is a fee for providing liquidity. Its size is set by (a) how big the forced trade was, (b) how fast providers refill, and (c) how often we mistake news for pressure. Costs (about 15 bps round trip in our protocol) are paid on every trade, so the fee has to clear them.

## 2. Where it lives in our code today

- **Size of the stretch:** `z = (close - vwap)/sigma`, where `sigma` is the volume-weighted dispersion of *price levels* since 9:30, not return volatility (`vwap.ts:57-63`). Consequence: for a steady, linear drift, the close sits about √3 ≈ 1.73σ from VWAP. So `entryZ=2` already skips smooth trends and fires only on acceleration or a late shock (derivation: uniform prices on [0,D] give VWAP=D/2 and σ=D/√12).
- **Is the fee worth it:** the `edgeBps` gate (`rules.ts:53-54`, knob `minEdgeBps`, `team3ReversalConfig.ts:26,84`). Costs live in `contract/protocol.ts:28-30`: 5 bps slippage + 2 bps half spread per side, plus $0.005/share. That is about 14 bps plus commission round trip.
- **Fade while the push is on:** side is taken from this bar's move, so we enter on a bar still moving *away* from VWAP (`rules.ts:50-52`). Per [9], that is during ongoing pressure.
- **Information exit:** `stopZ` (`rules.ts:71`) is the "this was news" escape hatch. `target` = back to VWAP (`rules.ts:72`) assumes *full* reversion. `maxHoldBars` (`rules.ts:73`) caps how long we wait for providers to refill.
- **Info-heavy windows:** `skipOpenMinutes` / `lastEntryMinutesBeforeClose` (`rules.ts:26-32`). The code comments justify them by "sigma warm-up". The R1 reason is that the open is when overnight information is being priced.
- **Two-sided flow:** `vwap.crossings` (`vwap.ts:65`) feeds the finished `vwapRegime` filter (`filters/vwapRegime.ts:21-24`). Many crossings means a balanced, inventory-driven day.
- **Volume:** the `useVolume` switch and `volumeMaxRatio=3` (`team3ReversalConfig.ts:52,63,101`) are a **stub that always allows** (`filters/volume.ts:23-26`, `filters/index.ts:38`). **Validation refuses `useVolume=true` while it is a stub** (`team3ReversalConfig.ts:168-170`), so it cannot be ablated yet. `useRelativeToSpy` has the same limit.
- **Primitives available to a filter:** `bar.{open,high,low,close,volume}`, `history` = the last `lookbackBars` (30) earlier session bars (`team3ReversalStrategy.ts:92`), `move`, `side`, `vwap.*`, `barsOf()` (`filters/types.ts:40-57`).
- **Free diagnostics:** entry meta already logs `vwapZ`, `edgeBps`, `vwapCrossings` and `sessionBars` (`team3ReversalStrategy.ts:133-137`). Bucketing A01's trades by these needs **no new run**. Bar volume is *not* in the meta.

## 3. Toggle experiments (no new code)

Every row uses the protocol (AGENT_GUIDE §2), runs on Core and Momentum, and tunes on IS only. Validation constraints: `stopZ > entryZ`; the `useVolume` and `useRelativeToSpy` switches are refused while they are stubs.

| ID | Config diff vs baseline | Compared to | Metric that should move | Why (mechanism) |
|---|---|---|---|---|
| R1-E1 | `minEdgeBps=30` | A01 | Avg net bps/trade ↑, cost share ↓, trades ↓ | Today the gate equals the cost (~15 bps). That only breaks even if price returns *fully* to VWAP and we fill at the signal close. We fill one bar later and usually get partial reversion, so the fee must be roughly 2× cost. |
| R1-E2 | `minEdgeBps=0` | A01 | Avg *gross* bps/trade (net + costs) | Diagnostic: the raw liquidity fee at the z gate. If gross is below ~15 bps, no threshold tuning can save the baseline. |
| R1-E3 | `entryZ=2.5` | A01 | Win % and avg bps ↑ (liquidity), or stop-exit share ↑ (information) | Grossman–Miller: a bigger forced trade pays a bigger fee. But big stretches are also more often news. The sign of this row says which effect dominates in our universe. |
| R1-E4 | `stopZ=5` | A01 | Payoff and PF ↑ with Max DD no worse means stops were cutting liquidity trades. Worst day ↓ means the stop catches news. | Tests whether extra stretch is more pressure (keeps reverting) or information (trend). |
| R1-E5a / b | `maxHoldBars=10` / `maxHoldBars=90` | A01 | Avg bps/trade, exit-reason mix (time vs target), avg hold | Speed of refill: imbalance effects fade in 5–60 min [9], while NYSE inventory pressure has a half-life of about 0.92 days [2]. This tells us which clock we are on. |
| R1-E6 | `skipOpenMinutes=30` | A01 | Win % ↑, stop share ↓, trades ↓ | The open is price discovery for overnight news. Stretches there are more often information. (May overlap with the time-of-day research.) |
| R1-E7 | `useVwapRegime=true` (`minVwapCrossings=4`) | A01 | Worst day ↑, Max DD ↓, % days profitable ↑ | Frequent VWAP crossings mean two-sided, inventory-driven flow, which is the regime where providers get paid. |
| R1-E8 | none (group split): A01 Core vs A01 Momentum, plus a per-symbol P&L breakdown of A01 (SPY/QQQ vs single names) | A01 vs A01 | Avg bps and PF per group or symbol | Llorente et al.: names with more informed trading (NVDA, TSLA, MU, AMD) should reverse less than index ETFs and mega-cap Core names. |

## 4. Candidate one-line features (not implemented), ranked

1. **Fade the turn, not the push** (no knob)
   - One-liner, with side taken from `vwap.z` instead of the move: `const turned = vwap.z > 0 ? bar.close < prev.close : bar.close > prev.close;` Enter only if `turned && |z| >= entryZ && edgeBps >= minEdgeBps`.
   - Mechanism: the fee is collected when the impatient order *finishes*. While it is still arriving, persistent imbalance pushes the price further [9]. Waiting for the first counter-bar is a cheap sign that the demander has stopped.
   - Evidence: imbalance persistence and intraday predictability [9]; the inventory-pressure logic in [1][2]. No study tests this exact 1-minute rule (unverified as a rule).
   - Overfit risk: **low**. It adds no parameter and is a single sign flip. The cost: we give up the first bar of reversion and take fewer trades.
   - Extends or replaces: it replaces the side/stretch lines in `entryIdea` (`rules.ts:50-52`). Ablate it as a new switch so the baseline stays intact.
2. **Volume shock filter** (fills the `volume` stub)
   - One-liner: `return input.bar.volume <= input.config.volumeMaxRatio * computeMean(input.history.map(b => b.volume));`
   - Mechanism: an extreme 1-minute volume burst in a mega-cap is usually an event (an in-session release such as 10:00 data or 14:00 FOMC, or a headline). That is information, which persists. This mapping is our inference (unverified).
   - Evidence: it is **two-sided**. CGW [5] say high-volume moves in large stocks *reverse more*. Llorente et al. [6] say they continue only where informed trading is heavy. Chan [7] finds news moves drift. So the stub's header claim ("high volume = news") is a hypothesis to test, not a fact. Prediction: the filter helps Momentum more than Core.
   - Overfit risk: **low–med**. It has one knob, but intraday volume is U-shaped, so a 30-bar mean is inflated just after the open and lags the rise into the close. Try only 3 and 5, on IS.
   - Extends or replaces: it fills `filters/volume.ts` with the existing `volumeMaxRatio`.
3. **Signed-volume pressure** (bar-level proxy for bulk volume classification)
   - One-liner: `const w = input.history.slice(-10), imb = w.reduce((s,b)=>s+Math.sign(b.close-b.open)*b.volume,0) / w.reduce((s,b)=>s+b.volume,0);` Block when `|imb| > k` in the direction of the stretch.
   - Mechanism: persistent one-sided flow looks like a split institutional order or informed trading, not a one-off liquidity shock.
   - Evidence: imbalance persistence [9]; Easley–López de Prado–O'Hara 2016 [12] show that classifying volume from bar price changes relates to proxies of information-based trading. Note that they use the standardized price change, not our sign rule.
   - Overfit risk: **med–high**. It needs a window and a threshold, and the sign proxy is crude.
   - Extends or replaces: it would be a new filter, or a second mode of the volume filter.
4. **Abrupt vs gradual stretch**
   - One-liner: `Math.abs(bar.close - input.history[input.history.length-5].close) >= 0.5 * Math.abs(bar.close - vwap.vwap)`, which allows only stretches built mostly in the last ~5 bars.
   - Mechanism: a liquidity sweep arrives in a burst, while informed flow builds gradually [4]. But news also jumps, so the sign is ambiguous.
   - Evidence: weak and indirect (only [4]).
   - Overfit risk: **med** (two magic numbers).
   - Extends or replaces: it would be a new filter. Rank it below the others until candidates 1–3 are tested.
- *Related but owned elsewhere:* removing the market component (`relativeToSpy`) is the same liquidity-vs-fundamentals split as Da–Liu–Schaumburg [8].

## 5. Simplify / cut

- **`minEdgeBps=15` is mis-specified.** It equals round-trip cost instead of cost plus a margin for partial reversion and one-bar fill lag. State it as "≥ k × round-trip cost" and test k≈2 (R1-E1).
- **The "same side as the move" rule fades *during* pressure.** R1 says to fade after it ends. This is a candidate replacement (feature 1), not a cut, until ablated.
- **The volume stub's stated rationale is backwards for half the literature.** Rewrite `docs/team3/components/volume.md` as a hypothesis with both signs, and note the U-shape confound.
- **`target` = full return to VWAP** assumes 100% reversion. In practice most exits may come from `time`. Check A01's exit-reason mix before adding any partial-target knob.
- **The `skipOpenMinutes` comment says "sigma warm-up";** the stronger reason is information arrival at the open. This is a doc fix only.
- Nothing needs deleting. `entryZ`, the z stop and the time stop all have an R1 reason.

## 6. Verdict

- **This lever decides whether the strategy makes money: it can make or break profitability, and today it most likely *breaks even or loses* until `minEdgeBps` is raised.** The liquidity fee is smallest in exactly the names we trade [10][11], and our modelled costs (~15 bps round trip) are large relative to a 1-minute fee in mega-caps.
- The most likely helper is cost-aware gating (R1-E1). After that, "fade the turn" and a volume filter whose *sign* is tested rather than assumed.
- **Confidence: low–moderate.**
  - Why: the mechanism is well established (theory [1][2][4], empirics [3][5][6][9]).
  - But: most evidence is daily, weekly or monthly, on older samples. Intraday imbalance effects have been shrinking over time [9]. Volume points in opposite directions depending on information asymmetry [5][6].
  - Only the ablation rows can settle it.

## 7. Sources

1. Grossman, S. & Miller, M. (1988). *Liquidity and Market Structure.* Journal of Finance 43(3), 617–637. https://www.nber.org/papers/w2641
2. Hendershott, T. & Menkveld, A. (2014). *Price Pressures.* Journal of Financial Economics 114(3), 405–423. Avg pressure 0.49%, half-life 0.92 days (published abstract; the working paper reports different numbers). https://ideas.repec.org/a/eee/jfinec/v114y2014i3p405-423.html
3. Nagel, S. (2012). *Evaporating Liquidity.* Review of Financial Studies 25(7), 2005–2039. https://www.nber.org/papers/w17653
4. Kyle, A. (1985). *Continuous Auctions and Insider Trading.* Econometrica 53(6), 1315–1335. https://www.econometricsociety.org/publications/econometrica/1985/11/01/continuous-auctions-and-insider-trading
5. Campbell, J., Grossman, S. & Wang, J. (1993). *Trading Volume and Serial Correlation in Stock Returns.* QJE 108(4), 905–939. https://dash.harvard.edu/bitstream/1/3128710/2/campbell_trading.pdf
6. Llorente, G., Michaely, R., Saar, G. & Wang, J. (2002). *Dynamic Volume-Return Relation of Individual Stocks.* RFS 15(4), 1005–1047. https://www.nber.org/papers/w8312
7. Chan, W. (2003). *Stock Price Reaction to News and No-News: Drift and Reversal after Headlines.* JFE 70(2), 223–260. https://econpapers.repec.org/RePEc:eee:jfinec:v:70:y:2003:i:2:p:223-260
8. Da, Z., Liu, Q. & Schaumburg, E. (2014). *A Closer Look at the Short-Term Return Reversal.* Management Science 60(3), 658–674. https://ideas.repec.org/a/inm/ormnsc/v60y2014i3p658-674.html
9. Chordia, T., Roll, R. & Subrahmanyam, A. (2005). *Evidence on the Speed of Convergence to Market Efficiency.* JFE 76(2), 271–292. https://ideas.repec.org/a/eee/jfinec/v76y2005i2p271-292.html
10. Avramov, D., Chordia, T. & Goyal, A. (2006). *Liquidity and Autocorrelations in Individual Stock Returns.* Journal of Finance 61(5), 2365–2394. https://ideas.repec.org/a/bla/jfinan/v61y2006i5p2365-2394.html
11. Grant, J., Wolf, A. & Yu, S. (2005). *Intraday Price Reversals in the US Stock Index Futures Market: A 15-Year Study.* Journal of Banking & Finance 29(5), 1311–1327. https://ideas.repec.org/a/eee/jbfina/v29y2005i5p1311-1327.html
12. Easley, D., López de Prado, M. & O'Hara, M. (2016). *Discerning Information from Trade Data.* JFE 120(2), 269–285. https://ideas.repec.org/a/eee/jfinec/v120y2016i2p269-285.html
13. Conrad, J., Hameed, A. & Niden, C. (1994). *Volume and Autocovariances in Short-Horizon Individual Security Returns.* Journal of Finance 49(4), 1305–1329. Background only: high-transaction stocks reverse, while low-transaction stocks show positive autocovariance (weekly). https://ideas.repec.org/a/bla/jfinan/v49y1994i4p1305-29.html
14. Repo citation "SSRN 6438039" (VWAP deviations as order imbalances), used in `baseline.md` and `vwapRegime.ts`: **(unverified)**. SSRN returned 403 and web search did not find it. Confirm the title and authors before citing it in the paper.
