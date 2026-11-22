# R4 Exit geometry: how much of the reversion we capture

> Research note (VERSION 3 baseline). Nothing here is implemented, and no backtest has run, so nothing here claims profit.

## 1. Mechanism

**Exits cannot create edge, they only decide how much of the reversion we keep and how much of a trend day we sit through. Where the barriers belong depends on how fast and how reliably price snaps back to VWAP.**

- **The null to beat (random walk).** If price had no pull back to VWAP, no choice of target, stop or time limit could change expected gross P&L. This is optional stopping on a martingale, and it is exactly Kaminski & Lo's random-walk result [5]. Every exit then just loses round-trip costs. So exit geometry is worth tuning only to the extent that the reversion is real.
- **Barriers set win rate against payoff.** Measure in sigmas at entry. Target distance is `d_T = z_entry − 0` (≈ 2) and stop distance is `d_S = stopZ − z_entry` (≈ 1.5). On a random walk, `P(target first) = d_S / (d_S + d_T)`, which is the gambler's-ruin formula:
  | Geometry | d_T | d_S | Null win rate | Null payoff ≈ d_T/d_S |
  |---|---|---|---|---|
  | Baseline (2 → 0, stop 3.5) | 2.0 | 1.5 | 43% | 1.33 |
  | Partway target (exit at 0.5) | 1.5 | 1.5 | 50% | 1.0 |
  | Wide stop (stopZ 5) | 2.0 | 3.0 | 60% | 0.67 |
  A measured win rate above the null row is the evidence of reversion. A high win rate on its own proves nothing.
- **Reversion speed is the half-life.** In an Ornstein–Uhlenbeck (OU) model the gap left after `t` bars is `d·2^(−t/H)`, where `H` is the half-life. With z=2 at entry, z reaches 1 after one half-life, 0.5 after two, and 0 only by noise. So the last 0.5σ is the slowest part, and that is where `maxHoldBars` usually ends the trade. Chan's rule of thumb: cap the hold at about 3×H, because "too early" is a better reading of a mean-reversion loss than "wrong" [7].
- **What the theory says about the target.** Pure OU with a fixed cost per trade says *don't stop partway*. Bertram's return-per-unit-time optimum is symmetric about the mean, so the exit is the mirror image of the entry [1][2]. Zeng & Lee get either "exit at the mean" or "exit at the mirror" [2]. A partway target pays only when the stop is tight: "a higher stop-loss level always implies a lower optimal take-profit level" [4]. Leung & Li also find the entry region "lies strictly above the stop-loss level" [4]. In plain words, don't enter when you are already close to the stop.
- **Stops and trend days.** Kaminski & Lo: on a random walk a stop only lowers return, and it adds value only when losses are followed by more losses (momentum) [5]. Chan: stops suit trend-following trades, not mean-reversion ones [7]. Intraday, the momentum regime does exist. Gao et al. find the first half-hour predicts the last half-hour on SPY [10]. So `stopZ` is trend-day insurance with a premium: it cuts some trades that would have reverted.
- **Our anchor moves (specific to our code).** VWAP drifts toward price during the trade, and sigma grows through the day. Both pull z toward 0 *without* price moving. Effects:
  - a `target` can fire after less price reversion than `edgeBps` promised;
  - the z stop moves further away in price terms the longer we hold, so trend-day losses may leak into `time`/`close` exits instead of `stop`.

## 2. Where it lives in our code today

- Exit knobs: `stopZ`, `maxHoldBars` (`team3ReversalConfig.ts:28-32`), defaults 3.5 / 30 (`:85-86`). Validation requires `stopZ > entryZ` and `maxHoldBars` to be a positive integer (`:132-134`). Form fields are at `manifest.ts:43-44`.
- Exit order (`rules.ts:67-75`):
  - `stale` (`:69`), `close` (`:70`, set by `flattenMinutesBeforeClose` through `sessionWindow`, `:26-32`)
  - `stop` (`:71`), `target` hard-coded at z crossing **0** (`:72`), `time` (`:73`)
  - The order of stop and target doesn't matter: they can't both be true at the same z.
- `ExitKnobs` exposes only `stopZ`, `maxHoldBars` (`rules.ts:23`). There is no target knob.
- Entry geometry: `stretched` has a lower bound but **no upper bound** (`rules.ts:52`). `edgeBps` is the distance to VWAP at entry (`:53`).
- z comes from the *last close* against the live session VWAP and sigma (`vwap.ts:55-66`). The exit reads it fresh every bar (`team3ReversalStrategy.ts:118`).
- Hold clock: `book.tick` adds one to `barsHeld` per session bar (`contract/book.ts:73-77`) and resets it to 0 on a fill (`:115`).
- Data for the analysis already in signal meta:
  - entry: `vwapZ`, `edgeBps`, `vwapSigma` (`team3ReversalStrategy.ts:133-137`)
  - exit: `reason`, `barsHeld`, `pnlBps`, `vwapZ` (`:120-123`)
- Fills land at the next bar's open (CONTRACT.md G1). Stop exits on fast bars therefore fill worse than the z that triggered them.

## 3. Toggle experiments (no new code)

All rows: Core and Momentum, in-sample first, standard protocol. Each row changes one field from the row it's compared to.

| ID | Config diff vs baseline | Compared to | Metric that should move (direction) | Why |
|---|---|---|---|---|
| R4-E1a | `stopZ=3.0` | A01 | stop share ↑, win % ↓, payoff ↑, worst day ↓ (smaller loss), net P&L likely ↓ | Tighter stop (d_S=1.0): Kaminski–Lo says it cuts trades that would have reverted |
| R4-E1b | `stopZ=4.0` | A01 | stop share ↓, win % ↑, payoff ↓ | Wider stop: tests where the bend in the trade-off sits |
| R4-E1c | `stopZ=5.0` | A01 | win % ↑, payoff ↓, max DD ↑ | Null win rate goes to 60%; shows how big the tail is |
| R4-E2 | `stopZ=100` (stop effectively off) | A01 | win % ↑, max DD and worst day ↑; net P&L: the key unknown | Direct Kaminski–Lo test. If net goes up and DD barely moves, the stop has no value |
| R4-E3a | `maxHoldBars=10` | A01 | time share ↑, avg hold ↓, win % ↓ if H > 10 | Hold shorter than the half-life cuts reversion short |
| R4-E3b | `maxHoldBars=15` | A01 | as E3a, smaller effect | Grid point |
| R4-E3c | `maxHoldBars=60` | A01 | target share ↑, avg hold ↑, worst trade ↓ (bigger loss) | Tests whether trades that hit `time` would have reverted later |
| R4-E4 | `maxHoldBars=390` (time off) | A01 | close share ↑, tail ↑ | Pure "hold until back or bell" |
| R4-E5 | `stopZ=100, maxHoldBars=390` | R4-E4 | (one change vs E4) full trend-day tail exposed | The Gatev-style rule: exit only on convergence or end of period [6]. This is the upper bound on what reversion pays |
| R4-E6 | `entryZ=2.5` | A01 | trades ↓, d_S falls to 1.0, d_T rises, stop share ↑ | Moving entry also moves stop distance (`stopZ − entryZ`) |
| R4-E7 | `entryZ=2.5, stopZ=4.0` | R4-E6 | (one change vs E6) stop share ↓ back to baseline | Same stop gap as baseline, bigger target: tests the payoff side alone |
| R4-E8 | `lastEntryMinutesBeforeClose=35` | A01 | close share ↓, late-day losers ↓ | Today a 15:44 entry gets ~10 bars, not 30, and fights end-of-day momentum [10] |

**Record in every R4 row (optional metrics):**
- exit-reason mix: count, net bps and win % *per reason*
- avg holding bars per reason
- cost share
- worst day P&L
- measured win % next to the null win % computed from the actual `z_entry` of each trade
- **capture ratio** = exit `pnlBps` ÷ entry `edgeBps`, per trade, from the meta fields above

**Half-life estimate:** no code needed. Take the median `barsHeld` of `target` exits in A01 as `H`. If `maxHoldBars` is well below 3×H, E3c should win.

## 4. Candidate one-line features (not implemented), ranked

1. **Don't enter at or past the stop** (no new knob)
   - One-liner, in `entryIdea`: `const stretched = side === "sell" ? vwap.z >= c.entryZ && vwap.z < c.stopZ : vwap.z <= -c.entryZ && vwap.z > -c.stopZ;`
   - Mechanism: a bar that closes at z ≥ 3.5 is entered and then stopped on the very next bar unless it reverts within one minute. That trade pays full costs for a coin flip. In general the real stop distance is `stopZ − z_entry`, not `stopZ − entryZ`.
   - Evidence: Leung & Li's optimal entry region is bounded away from the stop [4].
   - Overfit risk: **low**. No new number, and it removes a contradiction in the rules.
   - Component: extends the baseline entry (`rules.ts:52`), and needs `stopZ` added to `EntryKnobs`. Check first how often `z_entry ≥ 3.5` happens in A01 meta.
2. **`exitZ` target knob** (default 0 = today)
   - One-liner, at `rules.ts:72`: `if (z !== null && (short ? z <= c.exitZ : z >= -c.exitZ)) return "target";`
   - Mechanism: it trades win rate for payoff, as in the table in §1. A positive value (0.5) takes the fast part of the reversion before the slow tail and the time stop. A negative value (−0.5) runs past VWAP to make each fixed cost go further.
   - Evidence:
     - pure OU favors 0 or the mirror, not partway [1][2];
     - a partway target is justified only by a tight stop [4] or a short time budget [8];
     - Gatev et al. exit at the crossing [6].
   - Overfit risk: **med**. One continuous knob that interacts with `stopZ` and `maxHoldBars`. Test only the values {0.5, 0, −0.5}.
   - Must pair with an edge gate measured to the exit level, `edgeBps * (Math.abs(vwap.z) − c.exitZ) / Math.abs(vwap.z) >= c.minEdgeBps`. Without it, exitZ=0.5 cuts gross by 25% while `minEdgeBps=15` is only about break-even on round-trip costs (2×(5+2) bps plus commission).
   - Component: replaces the hard-coded 0 in `exitReason`.
3. **Price-anchored stop** (new knob `stopBps`; needs `entryPrice` passed into `HoldingView`, which `Holding` already has)
   - One-liner: `if (short ? close >= h.entryPrice*(1+c.stopBps/1e4) : close <= h.entryPrice*(1-c.stopBps/1e4)) return "stop";`
   - Mechanism: the z stop drifts away in price as VWAP chases and sigma grows, so a slow trend day never triggers it. A stop fixed in price doesn't drift.
   - Evidence: the "anchor moves" point in §1. Triple-barrier exits are set from the entry price [8][9].
   - Overfit risk: **med-high**. It adds a knob, and a sensible bps value differs between SPY and TSLA. Try it only if E2 and the exit mix show `time` and `close` losers dominating the tail.
   - Component: replaces or complements the `stop` line.

Not proposed: a trailing stop, which Chan doesn't recommend for mean reversion [7].

## 5. Simplify / cut

- **Mis-specified: the stop distance.** The docs and validation treat it as `stopZ − entryZ`. The real distance is `stopZ − z_entry` and can be zero or negative (candidate 1). Fix the entry cap before tuning `stopZ`.
- **Mis-specified: what `target` means.** z reaching 0 counts as success even when VWAP came to us. Report the capture ratio so the paper doesn't overstate the reversion.
- **Possibly cut: `stop`.** If R4-E2 shows the same or better net P&L and a similar max DD, the theory [5][7] says drop it and let `time` + `close` be the risk limit. That makes the rule set smaller.
- **Keep** `stale` (a one-line safety net), `close` and `time`. `time` is the exit mean-reversion theory actually endorses [7].
- **Coupling to watch:** `maxHoldBars` (30) is larger than the time left for entries in the last 30 minutes. `close` quietly becomes the time stop there (E8).

## 6. Verdict

- **Keeps or breaks; it doesn't make.** Under a random walk every exit choice nets −costs [5]. Exits can only collect reversion that the entry already found.
- **Ways it breaks:**
  - a stop tight against a reverting process (E1a);
  - a partway target with no edge-gate fix (it falls below the ~15 bps round-trip cost);
  - a hold shorter than the half-life.
- **Ways it keeps:**
  - capping entries below `stopZ`;
  - matching `maxHoldBars` to about 3×H;
  - limiting trend-day tails via `stopZ` or `time`.
- **Confidence:** medium on the directions (well-established theory, and they follow from our code's arithmetic). Low on magnitudes and on whether the stop is worth keeping, because our z isn't a stationary OU (VWAP moves, sigma grows, and fills land at the next open) and no backtest exists.

## 7. Sources

1. Bertram, W.K. (2010). Analytic solutions for optimal statistical arbitrage trading. *Physica A* 389(11), 2234–2243. doi:10.1016/j.physa.2010.01.045. https://econpapers.repec.org/RePEc:eee:phsmap:v:389:y:2010:i:11:p:2234-2243 (symmetric-exit result read through [2], not the original PDF)
2. Hudson & Thames. Optimal Trading Thresholds for the O-U Process (summary of Bertram 2010 and Zeng & Lee 2014). https://hudsonthames.org/optimal-trading-thresholds-for-the-o-u-process/ (Zeng & Lee 2014, "Pairs trading: optimal thresholds and profitability", *Quantitative Finance*: venue and details not checked directly, (unverified))
3. Holý, V. & Černý, M. Bertram's pairs trading strategy as convex optimization. arXiv:2102.04160. https://arxiv.org/abs/2102.04160 (title from search listing, (unverified))
4. Leung, T. & Li, X. (2015). Optimal mean reversion trading with transaction costs and stop-loss exit. *IJTAF* 18(3), 1550020. https://arxiv.org/abs/1411.5062 · https://ideas.repec.org/a/wsi/ijtafx/v18y2015i03ns021902491550020x.html
5. Kaminski, K.M. & Lo, A.W. (2014). When do stop-loss rules stop losses? *Journal of Financial Markets* 18, 234–254. doi:10.1016/j.finmar.2013.07.001. https://dspace.mit.edu/handle/1721.1/114876
6. Gatev, E., Goetzmann, W.N. & Rouwenhorst, K.G. (2006). Pairs trading: Performance of a relative-value arbitrage rule. *RFS* 19(3), 797–827. https://econpapers.repec.org/RePEc:oup:rfinst:v:19:y:2006:i:3:p:797-827 · NBER w7032: https://www.nber.org/papers/w7032 (rule "open at 2 historical sd, unwind when prices next cross, close at end of the 6-month period" taken from working-paper text and secondary summaries, not checked against the RFS version)
7. Chan, E.P. (2007). What is your stop-loss strategy? (blog post and the author's comments on half-life as max holding period). https://epchan.blogspot.com/2007/01/what-is-your-stop-loss-strategy.html
8. Lipton, A. & López de Prado, M. (2020). A closed-form solution for optimal mean-reverting trading strategies. arXiv:2003.10502. https://arxiv.org/abs/2003.10502 (target / stop / max-horizon exits, Sharpe-optimal levels; specific levels not read)
9. López de Prado, M. (2018). *Advances in Financial Machine Learning*, ch. 3 (triple-barrier method). Wiley. Chapter details known only from secondary sources, (unverified)
10. Gao, L., Han, Y., Li, S.Z. & Zhou, G. (2018). Market intraday momentum. *JFE* 129(2), 394–414. https://econpapers.repec.org/RePEc:eee:jfinec:v:129:y:2018:i:2:p:394-414
11. Baviera, R. & Santagostino Baldi, T. (2017). Stop-loss and leverage in optimal statistical arbitrage. arXiv:1706.07021. https://arxiv.org/abs/1706.07021 (treats the stop level as a given input; background only)
