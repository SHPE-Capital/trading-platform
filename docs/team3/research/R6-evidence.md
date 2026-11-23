# R6 Evidence: whether a result is real

**Category:** R6 (evaluation, not a trading rule) · **Status:** research, recommendations only · **Written:** 2026-11-21
**Question:** how do we run the ablation so the paper's numbers survive scrutiny?

## 1. Mechanism

**Why backtests lie, in one sentence:** if you try many configurations on one short stretch of data and keep the best, you mostly select luck, and luck does not repeat out of sample.

- **Noise is large next to the signal.** A Sharpe ratio estimated from T daily returns has standard error ≈ √((1 + SR²/2)/T) in daily units (Lo 2002, iid case). Our windows hold **32 IS and 21 OOS trading days** (Labor Day is the only holiday). The engine turns that into 31 and 20 daily returns, see §2; the ablation runner's `sharpeDaily` uses 32 and 21 (first day vs starting capital). Annualized, the SE is about **2.8 (IS) and 3.5 (OOS)** (√(252/32) = 2.81, √(252/31) = 2.85). *Checked 2026-11-23: the IS count is 32. The runs reported 33 because the engine stamps its final equity point with the wall clock ([UPSTREAM #10](../UPSTREAM.md)); `contract/daily.ts` now folds that point into the last real day. The SE above is unchanged.* An OOS Sharpe of 3 is therefore compatible with a true Sharpe of 0.
- **Selection inflates the best row.** Under the null, the expected *maximum* Sharpe over N independent trials is SR₀ ≈ √V·((1−γ)Φ⁻¹(1−1/N) + γΦ⁻¹(1−1/(Ne))), with γ ≈ 0.5772 (Bailey & López de Prado 2014, eq. 1). With 31 IS days, that luck-only best is about **1.5 for N=2, 3.4 for N=5, 4.5 for N=10 and 5.4 for N=20** (annualized; my calculation from the formula, using V = 1/T).
- **Trades are not independent.** Six symbols fade the same market on the same minute. A trend day hits every position at once. Inference should treat the **day** as the unit, not the trade. A count of 400 trades does not mean 400 independent observations.
- **The field already knows this.** Harvey, Liu & Zhu (2016) argue that after decades of data mining, a new factor needs t > 3.0, not 2.0. White (2000) and Bailey et al. (2017, PBO) formalize "the best of many is biased".
- **What this means for us:** the paper can be honest only if it (a) counts every configuration tried, (b) puts an interval on every headline number, and (c) touches OOS once.

## 2. Where it lives in our process today

**Already right:**
- Fixed protocol, changed only centrally with a full rerun: `AGENT_GUIDE.md:60`, `contract/protocol.ts:16`.
- Costs are never zero (`AGENT_GUIDE.md:68`). The edge must beat costs (`AGENT_GUIDE.md:104`, `baseline.md:29`).
- One change per row, with a `Compared to` column (`AGENT_GUIDE.md:76`). Tuning is IS only and OOS uses the knobs untouched (`AGENT_GUIDE.md:77`, `MASTER.md:59`).
- Results are saved with a `backtestId` (`AGENT_GUIDE.md:78`). The saved result keeps the full `equity_curve` and fills (`backtestEngine.ts:490-492`), so daily P&L can be rebuilt later without new engine code.
- Rows are append-only (`AGENT_GUIDE.md:81`). That is a natural trial log.
- A reference row is planned (`ablation.md:15` A00 `beginner_reversal`, `MASTER.md:17`).
- The engine computes daily-resampled Sharpe/Sortino, profit factor and a FIFO trade ledger (`performanceAnalytics.ts:48-63,176,201-229`; `backtestEngine.ts:440-464,545`).

**Gaps:**
- **No trial count.** Knob sweeps that never become rows are not logged. Without N, a deflated Sharpe is impossible and the selection bias above is invisible.
- **Point estimates only.** No column carries an SE, a CI or the number of days. "Too few = not significant" (`AGENT_GUIDE.md:103`) has no threshold.
- **The Sharpe definition differs from the doc.** The guide says mean ÷ std × √252 (`AGENT_GUIDE.md:108`). The engine annualizes geometrically, `(1+mean)^P − 1` over `std·√P`, with P taken from the calendar span (`performanceAnalytics.ts:222-229`). It buckets days by UTC (`:52`), which is fine because the regular session sits inside one UTC day. Reading the code, the first day's P&L is not a return: it has no prior-day close. So T days give T−1 returns (unverified by a test). The engine will print a Sharpe from as few as 4 days (`:37`).
- **No cash or zero-signal row, and no market context.** The engine can take a `benchmarkCurve`, but it reports only its total return (`performanceAnalytics.ts:180-186`).
- **The "best combination" step (`AGENT_GUIDE.md:88`) is a selection step** that does not record how many combinations were tried. Interactions between switches are never tested.
- **Trade-level stats count breakeven trades as losses** (`tradeLedger.ts:116-121`). This is harmless but should be stated in the paper.
- **The windows are still "to be confirmed"** (`ablation.md:7-8`). Both groups contain SPY (`AGENT_GUIDE.md:65`), so the groups are not independent samples.

## 3. Toggle experiments (no new code)

Every row uses the standard protocol and only `team3ReversalConfig.ts` fields, plus the window dates and `symbols`.

| ID | What is run | Compared to | What it proves | Pass criterion |
|---|---|---|---|---|
| R6-E1 | A00: `beginner_reversal` on Core IS **and** OOS | A01 baseline, same window | The VWAP/edge gates add value beyond "fade every bar" (the cost-bleed mechanism) | Baseline avg bps/trade > A00 and Net P&L > A00 in **both** windows |
| R6-E2 | Zero-trade check: baseline with `entryZ=50, stopZ=60` | Cash (exactly $0) | The engine creates no P&L or cost from nothing. Also defines the zero-signal benchmark | Trades = 0, Net P&L = $0.00, Sharpe undefined |
| R6-E3 | **Frozen OOS rerun:** the final IS config, unchanged, on OOS. Run once | Same config on IS; A01 on OOS | The IS choice was not fit to noise | Same sign of Net P&L. OOS avg bps/trade > 0. OOS daily-mean CI overlaps the IS one. No knob changes afterwards |
| R6-E4 | Symbol-group swap: the config chosen on **Core IS** run unchanged on **Momentum** IS + OOS | Momentum baseline | Whether the edge transfers. The mechanism predicts it is weaker on trendier names | Report either way. Call the result "general" only if avg bps/trade > 0 on both groups |
| R6-E5 | Sub-period split: rerun the final config on 4 windows: 09-01→09-22, 09-23→10-15, 10-16→10-30, 11-02→11-13 | Itself | The result is not one lucky stretch | Avg bps/trade > 0 in ≥ 3 of 4 windows |
| R6-E6 | Neighbor stability: `entryZ` 1.5 and 2.5 around the chosen value (`stopZ` 3.5 fixed) | Chosen config, IS | The result sits on a plateau, not a spike | Net P&L sign unchanged at both neighbors. These count in the trial ledger |
| R6-E7 | 2×2 factorial on the done switches: baseline, `useVwapRegime`, `useVolSizing`, both | Each other (Core IS) | Interaction: (both − regime) − (vol − baseline) | Interaction CI (tool T1) covers 0, so the one-at-a-time conclusions stand. If it does not, report the interaction |
| R6-E8 | No new run: per-symbol and per-day concentration from the saved ledger and equity curve | Final config | Profit is not one symbol or one news day | Net P&L minus the best day > 0. Top symbol < 50% of Net P&L |

## 4. Candidate one-line evaluation tools (not implemented), ranked

All tools run on **daily P&L** rebuilt from the saved `equity_curve` (last equity per day, differenced).

1. **T1. Paired day-bootstrap CI of a row's improvement.** *Built 2026-11-23: `npx ts-node src/runtime/team3Bootstrap.ts <baselineId> <rowId>` (logic in `contract/bootstrap.ts`, tests in `bootstrap.test.ts`). It uses iid day resampling, 10,000 draws and a fixed seed, and reports share B > A, a 95% CI and both IS halves. It refuses OOS runs before Stage 3. The stationary-bootstrap variant below is not built.* Take `d[i] = pnlRow[i] − pnlComparedTo[i]` on the same days, then:
   `const ci=(d:number[],B=1e4)=>{const m=Array.from({length:B},()=>d.reduce(s=>s+d[(Math.random()*d.length)|0],0)/d.length).sort((a,b)=>a-b);return[m[B*.025|0],m[B*.975|0]];}`
   - Guards against calling noise an improvement. Pairing cancels the shared market-day noise, which is exactly what the one-change ablation needs.
   - Source: Efron & Tibshirani (1993). For day-to-day dependence, use the stationary bootstrap with mean block ≈ 2–3 days (Politis & Romano 1994).
   - Cost: about 15 lines in a script. With only 20 days the percentile CI is a little too narrow, so call it "approximate".
2. **T2. Sharpe ± SE and t-stat** (Lo 2002): `se = Math.sqrt((1 + sr*sr/2)/T); t = sr*Math.sqrt(T)` (daily `sr`, multiply by √252 to annualize).
   - Guards against reading a point Sharpe as precise.
   - Cost: one line plus a `±` column. Lo also shows that autocorrelation biases the √252 scaling, so note it.
3. **T3. Deflated Sharpe (DSR)** (Bailey & López de Prado 2014): `SR0 = Math.sqrt(V)*((1-γ)*Φinv(1-1/N) + γ*Φinv(1-1/(N*Math.E)))` and `DSR = Φ((sr-SR0)*Math.sqrt(T-1)/Math.sqrt(1 - g3*sr + (g4-1)/4*sr*sr))`.
   - Guards against selecting the best of N configurations.
   - Cost: one line, **but it needs the trial ledger (N)** and the skew/kurtosis of daily returns. Use V = variance of the trial Sharpes, or 1/T as a null proxy.
4. **T4. Holm step-down across component rows** (Holm 1979): sort the M p-values from T1 or T2 and reject while `p[k] <= α/(M-k)` (k counted from 0).
   - Cost: one line. As a simpler rule of thumb, quote the HLZ t > 3 hurdle. With 53 days, t > 3 means an annualized Sharpe above ≈ 6.6.
5. **T5. Market context:** `corr(dailyPnl, spyDailyRet)` plus SPY buy-and-hold return per window, from SPY bars already in both groups.
   - Guards against a "reversal edge" that is really hidden market or short-volatility exposure. The paper should be able to say what happened on trend days.
   - Cost: trivial.
6. **T6. PBO by CSCV** (Bailey et al. 2017): split the 53 days into 8 blocks and form all C(8,4) = 70 IS/OOS halves. PBO is the share of halves where the IS-best config ranks below the median OOS.
   - Guards against overfitting across the whole grid.
   - Cost: about 40 lines plus a day × config P&L matrix. Only worth it if N ≥ 8 configs. Optional.

## 5. Simplify / cut

- **Cut full knob grids.** No `entryZ × minEdgeBps × stopZ × maxHoldBars` sweep. A 3×3×3×3 grid is 81 trials, and its luck-only best Sharpe would be about 7, larger than any plausible real edge.
- **Cut component-knob tuning.** `minVwapCrossings`, `vwapWindowBars`, `riskPerTradeUsd` and `volumeMaxRatio` stay at their defaults, pre-registered. A filter that only works after tuning its knob has not shown its mechanism.
- **Cut session-window and size tuning.** `skipOpenMinutes`, `lastEntryMinutesBeforeClose`, `flattenMinutesBeforeClose`, `tradeUsd`, `maxGrossUsd`, `maxPositionSizeUsd` and `lookbackBars` are design choices, not knobs to tune.
- **Replace "best combination" (`AGENT_GUIDE.md:88`) with R6-E7.** The 2×2 factorial estimates both main effects and their interaction from the same 4 runs. Each effect uses all runs (Czitrom 1999), and nothing is "picked".
- **Stub components** (Volume, Relative to SPY): if they are not done by Nov 22, leave them out rather than rushing them in. Each one adds a trial.
- **Knob budget (superseded 2026-11-23, see [MASTER Iteration rules](../MASTER.md#iteration-rules)):**
  - The original plan was 2 knobs, N ≤ 10, tuned on Core IS only. It's replaced by: at most **2 values per knob**, about **25 configs split by goal** (R3 4, R1 3, R2 2, R2-rts filter 2, R4 2+1, R5 2, combining + new signal 5, reserve 5; MASTER, updated 2026-11-23), with **Momentum as the main universe and Core as the control** (same config, never tuned separately).
  - OOS gets **zero** tuning and is untouched until Stage 3.
  - The luck-only IS best Sharpe rises with N. Recompute it at the final N in the ledger and write that number into the paper as the IS bar (it was about 4.5 at N = 10; about 5.6 at N = 25, T = 32).
  - In the table above, "Core IS" in R6-E1/E4/E7 now means "Momentum IS, with Core as control", and R6-E1's OOS half waits for Stage 3.

**Minimal protocol edits (recommendations only, for the lead):**
1. AGENT_GUIDE §2: add a **trial ledger** rule. Log every IS run, row or not. Report N in the paper.
2. `ablation.md`: add columns **Days**, **Sharpe ± SE**, and **Δ $/day vs Compared-to [95% CI]**.
3. Add an **OOS freeze** rule. OOS rows run once, after the IS config is recorded. Anything changed after seeing OOS becomes a new row labelled "post-OOS".
4. Fix `AGENT_GUIDE.md:108` to describe the engine's real Sharpe (geometric, span-annualized, T−1 returns), or report T2 alongside it.
5. Add **A0Z** (R6-E2, cash) and a SPY buy-and-hold context line per window to the `ablation.md` header.
6. Confirm and freeze the windows (`ablation.md:7-8`) before A01. Keep the 32/21 split: re-splitting after seeing results is itself a trial.

## 6. Verdict

**What the paper can honestly claim from about 10 weeks (53 days):**
- **Can claim, with high confidence (mechanical facts):** cost and trade-count effects. For example, "the VWAP and edge gates cut trades by X% and cost share by Y% versus `beginner_reversal`". These are large, deterministic and robust.
- **Can claim, with moderate confidence (direction):** an effect's sign and size in bps/trade, with a bootstrap CI. Phrase it as "consistent with", and only where the IS and OOS signs agree (R6-E3) and the sub-periods agree (R6-E5).
- **Cannot claim:** that the strategy has a statistically significant Sharpe or is "profitable" in general.
  - At 20 OOS returns, one-sided 95% significance needs an annualized Sharpe of about **5.8**. At 52 returns it needs about 3.6.
  - The minimum track record for a true Sharpe of 2 is about 170 days (normal approximation of Bailey & López de Prado's MinTRL).
  - So the right wording is: "a short-sample result: these windows cannot separate a modest real edge from luck."
- **Must state:** the number of configurations tried (N), that the groups share SPY, the one market regime covered (Sep–Nov 2026), and that no real backtest had been run at the time of writing.
- **Confidence in this verdict: high.** The arithmetic is standard and is shown above. The thresholds assume roughly normal, independent daily P&L. Fat tails from trend days make them stricter, not looser.

## 7. Sources

1. Lo, A. W. (2002). The Statistics of Sharpe Ratios. *Financial Analysts Journal* 58(4), 36–52. doi:10.2469/faj.v58.n4.2453. https://rpc.cfainstitute.org/research/financial-analysts-journal/2002/the-statistics-of-sharpe-ratios
2. Bailey, D. H., & López de Prado, M. (2014). The Deflated Sharpe Ratio: Correcting for Selection Bias, Backtest Overfitting, and Non-Normality. *Journal of Portfolio Management* 40(5), 94–107. doi:10.3905/jpm.2014.40.5.094. https://papers.ssrn.com/abstract=2460551 (eq. 1 read from the authors' PDF: https://www.davidhbailey.com/dhbpapers/deflated-sharpe.pdf)
3. Bailey, D. H., Borwein, J., López de Prado, M., & Zhu, Q. J. (2017). The Probability of Backtest Overfitting. *Journal of Computational Finance* 20(4). doi:10.21314/JCF.2016.322. https://papers.ssrn.com/abstract=2326253
4. Harvey, C. R., Liu, Y., & Zhu, H. (2016). …and the Cross-Section of Expected Returns. *Review of Financial Studies* 29(1), 5–68. https://www.nber.org/papers/w20592
5. Harvey, C. R., & Liu, Y. (2015). Backtesting. *Journal of Portfolio Management* 42(1). https://people.duke.edu/~charvey/Research/Published_Papers/P120_Backtesting.PDF (volume and issue unverified)
6. Bailey, D. H., & López de Prado, M. (2012). The Sharpe Ratio Efficient Frontier (minimum track record length). *Journal of Risk* 15(2). https://www.risk.net/journal-risk/2223785/sharpe-ratio-efficient-frontier (the MinTRL formula used in §6 is the normal-returns simplification, unverified against the paper)
7. White, H. (2000). A Reality Check for Data Snooping. *Econometrica* 68(5), 1097–1126. doi:10.1111/1468-0262.00152. https://www.econometricsociety.org/publications/econometrica/2000/09/01/reality-check-data-snooping
8. Politis, D. N., & Romano, J. P. (1994). The Stationary Bootstrap. *JASA* 89(428), 1303–1313. doi:10.1080/01621459.1994.10476870
9. Holm, S. (1979). A Simple Sequentially Rejective Multiple Test Procedure. *Scandinavian Journal of Statistics* 6(2), 65–70. https://www.jstor.org/stable/4615733
10. Czitrom, V. (1999). One-Factor-at-a-Time versus Designed Experiments. *The American Statistician* 53(2), 126–131. doi:10.2307/2685731
11. Efron, B., & Tibshirani, R. J. (1993). *An Introduction to the Bootstrap*. Chapman & Hall. (standard text, not re-checked online)
