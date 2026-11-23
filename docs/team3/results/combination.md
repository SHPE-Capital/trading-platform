# S2 combination: what stacking added

The S2 combining step, 2026-11-23, code VERSION 7, in-sample 2026-09-01 → 2026-10-15 (32 days). Numbers come only from the [S2 combination](../ablation.md#s2-combination) rows in the ledger. Rules: one step at a time, Momentum main, Core control. Each step is judged against the stack so far with the size-neutral **true test** ([MASTER, Budget](../MASTER.md#budget-30-configs-split-by-goal)): net bps/trade improves, bootstrap share ≥ 0.8, halves agree, Core doesn't contradict, and the step's mechanism moves. Why each piece is weak on its own: [why-individual.md](why-individual.md).

**Edge gap** = round-trip cost (~14.2 bps; net and zero-cost gross differ by 14.22 on baseline Momentum and 14.23 on C3) minus zero-cost gross bps/trade. A gap of 0 means break-even. "Share closed" is measured against the baseline gap of the same universe.

## Step by step

### Momentum (main)

| Step | Config | Keep | Trades | Net $ | Δ net $ vs prev | bps/trade | Δ bps | Gross bps | Δ gross | Gap bps | Gap closed (step / cumulative) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| V4 | baseline | — | 370 | −1,647.82 | — | −9.52 | — | +4.70 | — | 9.50 | — |
| C1 | `entryZ` 2.5 | reject | 136 | −421.22 | (+1,226.60) | −6.65 | (+2.87) | +7.55 | (+2.85) | 6.65 | (not stacked) |
| C2 | relativeToSpy, `rtsMinOwnShare` 0.7 | keep | 258 | −912.10 | +735.72 | −7.55 | +1.97 | +6.67 | +1.97 | 7.53 | 21% / 21% |
| C3 | C2 + crowd split | keep | 258 | −495.93 | +416.17 | −5.25 | +2.30 | +8.98 | +2.31 | 5.22 | 24% / 45% |
| C3b | C2 + `tradeUsd` 3,950 (control) | control | 258 | −702.72 | +209.38 vs C2 | −7.43 | +0.12 vs C2 | — | — | — | — |
| C4 | C3 + `stopZ` 100 | reject | 256 | −450.00 | (+45.93) | −4.80 | (+0.45) | — | — | — | (not stacked) |

### Core (control)

| Step | Trades | Net $ | Δ net $ vs prev | bps/trade | Δ bps | Gross bps | Δ gross | Gap bps | Gap closed (step / cumulative) |
|---|---|---|---|---|---|---|---|---|---|
| V4 | 419 | −3,048.74 | — | −15.32 | — | −1.08 | — | 15.28 | — |
| C1 | 193 | −1,560.94 | (+1,487.80) | −17.02 | (−1.70) | −2.78 | (−1.70) | 16.98 | (widens; not stacked) |
| C2 | 217 | −1,426.88 | +1,621.86 | −13.58 | +1.74 | +0.71 | +1.79 | 13.49 | 12% / 12% |
| C3 | 217 | −1,020.26 | +406.62 | −12.06 | +1.52 | +2.23 | +1.52 | 11.97 | 10% / 22% |
| C3b | 217 | −1,106.17 | +320.71 vs C2 | −13.59 | −0.01 vs C2 | — | — | — | — |
| C4 | 211 | −1,068.04 | (−47.78) | −12.86 | (−0.80) | — | — | — | (not stacked) |

Values in parentheses are for rejected steps, against the stack they were tested on (V4 for C1, C3 for C4).

## What each step did

**C1, `entryZ` 2.5 (rejected).** It's R1-01 rerun, so it doesn't count against the budget. On Momentum it looks like the largest win: −$421 on 136 trades. Most of that is cost saved on 234 dropped trades. The reversion share falls (17.6 → 14.7%), so the R1 mechanism fails. Core contradicts it on the size-neutral measures: bps/trade −15.32 → −17.02, gross −1.08 → −2.78. The stack stayed at V4.

**C2, relativeToSpy 0.7 (kept).** It's RS-02 rerun, also not counted. It drops 112 Momentum trades (370 → 258). Gross rises +1.97 bps and reversion rises to 19.8%, so the trades it keeps really are better, not just fewer. Bootstrap vs V4: share 0.9999 (from RS-02). On Core, gross turns positive for the first time (−1.08 → +0.71). It closes about a fifth of the Momentum gap and an eighth of the Core gap.

**C3, + crowd split (kept).** Trade count doesn't change (258 / 217); the split reallocates notional across names that signal together, and average notional per trade falls (Momentum 4,681 → 3,661, Core 4,842 → 3,899). Against C2: +$13.01/day, share 0.977, CI [0.2, 28.08], halves +6.73 (0.846) / +19.28 (0.957), which agree. Core agrees: +$12.71/day, share 1.000. Against V4: Momentum +$36.00/day, Core +$63.39/day, both share 1.000. The step closes another quarter of the Momentum gap (45% in total). The crowd split's own mechanism (lower drawdown on cluster days) **can't be measured** here: relativeToSpy already removes every cluster (0 left). So the mechanism condition was not verified for this step.

**C3b, size-matched control (not a stack step).** C2 with `tradeUsd` 3,950, about C3's average notional, separates "smaller bets" from "better allocation". Smaller bets alone leave bps/trade almost where it was (Momentum −7.55 → −7.43, Core −13.58 → −13.59) and recover $209 of C3's $416 on Momentum. So **about half of C3's dollar gain is just betting smaller**, and nearly all of its bps/trade gain (+2.18 of +2.30) is the reallocation. C3 vs C3b on Momentum: +$6.46/day, share 0.879, CI [−3.77, 18.32], halves +5.41 (0.812) / +7.51 (0.780), which agree. On Core it's weak: +$2.68/day, share 0.758, halves +5.52 / −0.15, which disagree.

**C4, + stop off (rejected).** It's R4-01 on top of C3. On Momentum it's a small gain: +$1.44/day, share 0.828, halves +1.73 / +1.14, bps −5.25 → −4.80. Core contradicts it: −$1.49/day, share 0.106, bps −12.06 → −12.86, and the 5th-percentile trade gets worse (−73.5 → −78.0 bps). That matches R4-01, where Core's mechanism already contradicted.

## Overlaps

- **relativeToSpy already contains R2-01.** RS-02 drops the index names as part of its filter, so R2-01 (exclude SPY/QQQ) was not stacked separately.
- **C1 and C2 both work partly by trading less.** C1 was tested first and rejected, so the two were never stacked together.
- **Crowd split and relativeToSpy overlap on clusters.** Crowd split targets days when several names signal together, and relativeToSpy already removes the market-wide part of those moves. The 0-cluster result shows the overlap is complete for the cluster-day mechanism. What C3 adds comes from the notional reallocation (C3b), not from cluster days.
- **R3 (`minEdgeBps` / cost gate)** wasn't part of S2. Every R3 row failed on mechanism (it works by trading less), and C2 already removes many low-edge trades.

## Trade counts

Momentum 370 (V4) → 258 (C2, C3, C3b) → 256 (C4). Core 419 → 217 (C2, C3, C3b) → 211 (C4). C1 would have cut Momentum to 136 and Core to 193. All of the count reduction in the final stack comes from relativeToSpy; crowd split changes size, not count.

## Budget

New configs spent in S2: 3 (C3, C3b, C4); C1 and C2 reproduce R1-01 and RS-02 and aren't counted. Total 19 of ~30; combining used 3 of its 10.

## Honest reading

The final S2 stack is **C3: relativeToSpy 0.7 + crowd split**. It is the best config found in-sample and it still loses money: Momentum **−$496, −5.25 bps/trade**, gross **+8.98 bps against ~14.2 bps of round-trip cost**; Core −$1,020, −12.06 bps, gross +2.23. The stack closes 45% of the Momentum gap and 22% of the Core gap; 5.2 bps (Momentum) and 12.0 bps (Core) are still missing per trade.

Two caveats on C3 itself. About half of its dollar gain over C2 is just smaller bets, which the size-neutral test is designed to discount. And the reallocation's per-dollar edge is only moderately supported: share 0.879 with a CI that includes zero on Momentum, and halves that disagree on Core. All of this is from the 32 in-sample days; whether any of it holds is a Stage 3 (out-of-sample) question.
