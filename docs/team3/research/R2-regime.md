# R2 Regime: when reversion works

**Category:** regime (entry filter / session window) · **Baseline:** VERSION 3 · **Status:** research only, nothing implemented, no backtest run yet.

## 1. Mechanism

**A stretch from VWAP comes back when somebody paid for immediacy and the price moved to accommodate them (a temporary liquidity shock). It keeps going when the move is new information, or when hedgers trade in the same direction as the move. Those are trend days, and on them the move is usually market-wide.**

- **Rotational day:** no new information arrives, and order flow is two-sided. A burst of one-sided orders (one large parent order, a stop cascade) pushes price away from VWAP, and liquidity providers get paid for leaning against it. That payment is the reversal (Nagel 2012 [6]). Intraday, this type of reversal plays out within about an hour (Heston, Korajczyk, Sadka 2010 [3]). That fits `maxHoldBars=30`.
- **Trend day:** information (macro news, earnings, a sector story) re-prices the asset, so VWAP is the *old* fair value and the target is wrong. Option market makers who are short gamma add to this, because hedging short gamma means buying rallies and selling dips (Baltussen, Da, Lammers, Martens 2021 [2]). At the market level, the day's return so far predicts the last half-hour (Gao, Han, Li, Zhou 2018 [1]; [2]).
- **Idiosyncratic vs systematic:** when we split a stock's move into market/industry and residual parts, only the residual ("non-fundamental") part reverses. The across-industry part shows *momentum* (Da, Liu, Schaumburg [4]; the same idea is the basis of ETF-residual stat-arb, Avellaneda and Lee [5]). Caveat: that evidence is from daily-to-monthly horizons, and the transfer to 1-minute bars is **(unverified)**.
- **Consequence for us:** a 2σ stretch in SPY or QQQ is by definition a market-wide move. It has no residual. The mechanism predicts those are our worst fades.
- **Costs make regime matter more:** the round trip is about 2 × (5 + 2) bps plus commission, roughly 14.5 bps, and `minEdgeBps=15` only just covers it. A trade pays only if price returns *fully* to VWAP. So we need days where full reversion is the norm, not the exception.
- **Detail in our own math (derived, check it):** z uses the *session-cumulative* sigma. On a perfectly linear trend with flat volume, the latest close sits at z → √3 ≈ 1.73 (VWAP is the midpoint, sigma = range/√12). So `entryZ=2` already skips smooth trends and fires on recent *acceleration*, which is the liquidity-shock signature. The same math means `stopZ=3.5` is rarely reached on a steady trend (see §5).

## 2. Where it lives in our code today

- **Regime filter:** `filters/vwapRegime.ts:21-24` (`vwap.crossings >= minVwapCrossings`, blocks if no VWAP). Registered first and marked `done` at `filters/index.ts:37`. Switch and knobs: `team3ReversalConfig.ts:51,59,61`, defaults `:94,99,100` (off, 4, 60).
- **Crossing counter:** `vwap.ts:47-51` stores, for each bar, which side of the *running* VWAP the close was on. `vwap.ts:81-90` counts side switches and skips exact zeros. `vwap.ts:65` applies the window. There is no band: a 1-cent wiggle around VWAP counts as a crossing.
- **Sigma / z:** `vwap.ts:57-63`, session-cumulative and volume-weighted. Entry gate: `rules.ts:48-55`. Stop / target / time: `rules.ts:71-73`.
- **Market vs idiosyncratic:** the stub `filters/relativeToSpy.ts:27-30` returns `true`, and `filters/index.ts:39` marks it `stub`. Validation refuses to switch it on (`team3ReversalConfig.ts:168-170`) and requires the benchmark in `symbols` (`:162-165`). So SPY is always traded too.
- **Same-minute SPY bar:** `barsOf` goes into filters at `team3ReversalStrategy.ts:96` (full session, guaranteed by contract G2 in `CONTRACT.md:30`). `history` is only the last `lookbackBars=30` bars (`team3ReversalStrategy.ts:92`).
- **Clock:** `sessionWindow` at `rules.ts:26-32`, knobs `team3ReversalConfig.ts:36-40` (15/15/5). Helpers: `session.ts:34-41`.
- **Diagnostics we already log:** entry meta carries `vwapCrossings`, `sessionBars`, `vwapZ` (`team3ReversalStrategy.ts:135-137`). Exit meta carries `reason` and `pnlBps` (`:121-123`). We can bucket A01's trades by these **without a rerun**.

## 3. Toggle experiments (no new code)

**Step 0 (free):** take A01's trades and bucket avg bps/trade by `vwapCrossings` (0-1, 2-3, 4-7, 8+), by entry minute-of-day, by symbol and by exit reason. If bps doesn't rise with crossings, E1-E3 are unlikely to help. Choose the rows from this table; don't run them all blind.

| ID | Config diff vs baseline | Compared to | Metric that should move | Why |
|---|---|---|---|---|
| R2-E1 | `useVwapRegime=true` (4 / 60) | A01 | Worst-day P&L ↑ (less negative), max DD ↓, win % ↑, avg bps ↑, trades ↓ | Fewer fades on one-sided (trend) days |
| R2-E2 | `useVwapRegime=true, minVwapCrossings=8` | R2-E1 | Avg bps ↑ again, trades ↓ | Dose-response: if crossings measure regime, a stricter gate gives a cleaner edge. If not monotone, it's noise |
| R2-E3 | `useVwapRegime=true, vwapWindowBars=390` | R2-E1 | % days profitable ↑, worst day ↑ | Tests whether the *day type* (whole session) predicts better than the last hour. Trend days tend to stay trend days |
| R2-E4 | `skipOpenMinutes=30` | A01 | Share of `stop` exits ↓, avg bps ↑, trades ↓ slightly | The first half-hour is when overnight news is priced in (the start of Gao's predictor), and sigma is tiny, so z is inflated |
| R2-E5 | `lastEntryMinutesBeforeClose=45` | A01 | Avg bps of late-day trades ↑, worst day ↑ | A 30-bar hold started after 15:15 overlaps the last half-hour, where market intraday momentum lives [1][2] |
| R2-E6 | `symbols=[AAPL,MSFT,GOOGL,AMZN]` (Core minus SPY, QQQ). Momentum: `[NVDA,AMD,MU,TSLA,META]` | A01 (same group) | Avg bps/trade ↑, PF ↑, trades ↓ | Removes the instruments with no idiosyncratic part. Diagnostic row: it changes the universe, so label it that way |
| R2-E7 | `useVwapRegime=true, skipOpenMinutes=30` | best of E1/E4 | Max DD ↓ beyond either alone | Run only if E1 and E4 each help. Checks whether they overlap (both throw away early-day trades) |

Tune on in-sample only. Report out-of-sample with the knobs frozen (AGENT_GUIDE §2). Add worst-day P&L and % days profitable to every row (the optional regime metrics).

## 4. Candidate one-line features (not implemented), ranked

**1. Residual stretch: fills the `relativeToSpy` stub.**
```ts
const k = config.lookbackBars, ret = (b: readonly BarView[]) => b.at(-1)!.close / b.at(-1 - Math.min(k, b.length - 1))!.close - 1;
return Math.abs(ret(barsOf(symbol)) - ret(barsOf(config.benchmarkSymbol))) >= 0.5 * Math.abs(ret(barsOf(symbol)));  // ≥ half of the 30-min move is the stock's own
```
- **Mechanism:** only the non-market part of a move is a liquidity shock that reverts. The market part is information or hedging flow that continues.
- **Evidence:** [4] residual-only reversal, across-industry momentum (monthly); [5] ETF-residual mean reversion (daily); [3] intraday liquidity-driven reversal under an hour. Intraday transfer **(unverified)**.
- **Overfit risk:** low. One threshold (0.5), β fixed at 1 (no estimation), and it reuses `lookbackBars`.
- **Notes:** it blocks SPY by construction, and QQQ nearly so, which is the intended prediction (compare with R2-E6). It measures over the stretch horizon, not the 1-minute `move` the stub comment suggests (§5). High-beta names (NVDA, TSLA) will show some market move as "own". That is accepted for simplicity.

**2. Market trend gate: don't fade anything while SPY is trending.**
```ts
const b = barsOf(config.benchmarkSymbol).slice(-61), path = b.slice(1).reduce((s, x, i) => s + Math.abs(x.close - b[i].close), 0);
return Math.abs(b.at(-1)!.close - b[0].close) / path * Math.sqrt(b.length - 1) < 3;   // net move < 3× a random walk's
```
- **Mechanism:** on a market trend day, hedging and information flow push every name the same way [1][2]. The ratio of net move to path length (Kaufman's efficiency ratio) is about 1/√n for a random walk, so "< 3" reads as "within 3× random-walk drift". This is the Lo-MacKinlay variance-ratio idea in one line [7].
- **Evidence:** [1] (OOS R² of about 1.2% for the last half-hour, S&P 500 ETF), [2] (about 60 futures, stronger when dealer gamma is more negative). That gamma-volatility link also shows up at stock level [8].
- **Overfit risk:** medium. The threshold is in random-walk units, not tuned bps, but the 60-bar window is a choice.
- **Extends:** `relativeToSpy` (same file and switch; one more `&&`), or `vwapRegime` applied to the market.

**3. Variance-ratio regime for the symbol itself: an alternative body for `vwapRegime`.**
The same line as #2 with `barsOf(symbol)`.
- **Mechanism:** directly measures "is this stock's path mean-reverting or drifting today?". Crossings are an indirect, noise-sensitive proxy (§5).
- **Evidence:** [7] for the test. For intraday regime classification, only practitioner write-ups [12] **(unverified academically)**.
- **Overfit risk:** medium. Run it head-to-head against R2-E1. Keep whichever wins and drop the other.
- **Replaces:** the body of `vwapRegimeAllows`.

**4. Don't fade an opening-range breakout.**
```ts
const or = barsOf(symbol).slice(0, 30); return side === "sell" ? bar.close <= Math.max(...or.map((b) => b.high)) : bar.close >= Math.min(...or.map((b) => b.low));
```
- **Mechanism:** breaking out of the first 30-minute range is the classic early trend-day tell. Fading beyond it means standing in front of informed flow.
- **Evidence:** opening-range breakouts on high-activity "stocks in play" are reported profitable net of costs [9] (a working paper, stocks only). Its use as a trend-day classifier is practitioner lore **(unverified)**.
- **Overfit risk:** high. It removes most large stretches, and 30 bars is arbitrary.
- **Extends:** the session window (pairs with R2-E4).

## 5. Simplify / cut

- **`useVwapRegime` may be redundant with `entryZ`.** Cumulative-sigma z already sits below 2 on smooth trends (√3 argument, §1). If R2-E1 barely changes trade count or worst day, cut the filter rather than tune it.
- **`stopZ=3.5` is mis-labelled as a "trend day" stop (`rules.ts:71`).** Sigma grows *with* the trend, so z rarely reaches 3.5 on a steady trend. Trend-day losses are actually capped by `time` (30 bars). The stop only catches a *second* sudden shock. Check the exit-reason mix in A01 before relying on it.
- **`target` is not always a win.** On a trend-then-pause day, VWAP catches up to price, so "back to VWAP" can fill above a short's entry. Report P&L by exit reason.
- **Crossings have no hysteresis (`vwap.ts:49,81-90`).** Closes hugging VWAP by a cent count as rotation, which inflates the count on high-priced, tight names like SPY. Prefer candidate #3, or a band (a code change, so out of scope here).
- **The stub's horizon is wrong (`relativeToSpy.ts:9-11`).** It compares this minute's move to SPY's. Our trade is about a stretch built over tens of minutes, and 1-minute comparisons are mostly bid-ask noise [3]. Compare over the stretch horizon (candidate #1).
- **`skipOpenMinutes` is justified as "sigma warms up".** The deeper reason is that the open is when the day type is decided. Keep it, relabel it, and test 30 (R2-E4).

## 6. Verdict

- **Keeps profitability, probably doesn't make it.** Regime filters cut the left tail (trend-day fades), so max DD and worst day should improve, and avg bps/trade should rise. They cannot create an edge the fade doesn't have. With about 14.5 bps round-trip against a 15 bps minimum edge, the base fade has to work first.
- **Most likely to *add* edge:** candidate #1 (idiosyncratic only). It has the strongest mechanism and published evidence, but only at longer horizons.
- **Could break it:** stacking several regime gates (E1 + E4 + #2 + #4) will leave too few trades for significance. Each gate also throws away early-day trades, so their effects overlap.
- **Confidence: medium on direction** for risk metrics (DD, worst day), because the trend-day mechanism is well documented [1][2]. **Low on magnitude and on net P&L**, because no backtest has run and the idiosyncratic-reversal evidence is from daily or monthly data.

## 7. Sources

1. Gao, Han, Li, Zhou (2018), "Market intraday momentum," *JFE* 129(2), 394-414. https://econpapers.repec.org/RePEc:eee:jfinec:v:129:y:2018:i:2:p:394-414. The OOS R² of 1.2% comes from the working-paper version.
2. Baltussen, Da, Lammers, Martens (2021), "Hedging demand and market intraday momentum," *JFE* 142(1), 377-403. https://econpapers.repec.org/RePEc:eee:jfinec:v:142:y:2021:i:1:p:377-403 · PDF: https://www3.nd.edu/~zda/intramom.pdf
3. Heston, Korajczyk, Sadka (2010), "Intraday patterns in the cross-section of stock returns," *JF* 65(4), 1369-1407. https://ideas.repec.org/a/bla/jfinan/v65y2010i4p1369-1407.html · preprint: https://arxiv.org/abs/1005.3535
4. Da, Liu, Schaumburg (2011), "Decomposing short-term return reversal," NY Fed Staff Report 513. https://www.newyorkfed.org/medialibrary/media/research/staff_reports/sr513.html. Published as "A closer look at the short-term return reversal," *Management Science* 60(3), 658-674 (2014). https://doi.org/10.1287/mnsc.2013.1766
5. Avellaneda, Lee (2010), "Statistical arbitrage in the US equities market," *Quantitative Finance* 10(7), 761-782. https://ideas.repec.org/a/taf/quantf/v10y2010i7p761-782.html
6. Nagel (2012), "Evaporating liquidity," *RFS* 25(7), 2005-2039. https://www.nber.org/papers/w17653
7. Lo, MacKinlay (1988), "Stock market prices do not follow random walks: evidence from a simple specification test," *RFS* 1(1), 41-66. https://web.mit.edu/~alo/www/Papers/lo-mackinlay-88.html
8. Ni, Pearson, Poteshman, White (2021), "Does option trading have a pervasive impact on underlying stock prices?," *RFS* 34(4), 1952-1986. https://ideas.repec.org/a/oup/rfinst/v34y2021i4p1952-1986..html
9. Zarattini, Aziz (2023), "Can day trading really be profitable?," SSRN 4416622. https://papers.ssrn.com/abstract=4416622. Follow-up: Zarattini, Barbon, Aziz (2024), "A profitable day trading strategy for the U.S. equity market," SSRN 4729284 (seen in search results only; not opened).
10. Kaufman, *Trading Systems and Methods* (efficiency ratio). Book, edition and page **(unverified)**.
11. SSRN 6438039, cited by `baseline.md` and `vwap-regime.md`: **could not be located (unverified)**.
12. LuxAlgo, "VWAP mean-reversion vs trend regimes" (practitioner, not peer-reviewed). https://www.luxalgo.com/library/concept/vwap-mean-reversion-vs-trend-regimes/
