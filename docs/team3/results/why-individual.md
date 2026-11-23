# Why no single change works on its own

One paragraph per R3 and Stage 2 row: why it fails, or why its pass is weak. Numbers come only from [ablation.md](../ablation.md) and the five ledgers. Baseline: A04 Momentum −1,647.82, 370 trades, −9.52 bps/trade, reversion 17.6% (exits time 283 / target 65 / stop 11 / close 11); A03 Core −3,048.74, 419 trades, −15.32 bps, 15.5%. "Net up" below always means "loses less".

## R3 costs (A05–A12)

**A05/A06, `minEdgeBps` 25: trading less.** Momentum trades fall from 370 to 330 and net bps/trade improves only from −9.52 to −8.73. The reversion share slips to 17.3%, so the trades it keeps don't revert more often. The gain (+$299) is the ~14 bps round trip saved on 40 dropped trades. On Core bps/trade stays flat (−15.28).

**A07/A08, `minEdgeBps` 35: trading less, more of it.** This is the best R3 row: 305 trades, −8.21 bps, +$473. The reversion share still falls (17.0%), and Core's falls too (13.6%). About +6 bps gross per trade against ~14 of cost. The optimum sits at the edge of the tested range.

**A09/A10, cost gate 0.5: trading less.** It works like a `minEdgeBps` of about 28.4: 323 trades, −8.50 bps, reversion 17.3%. It lands between A05 and A07, as expected.

**A11/A12, cost gate 0.6: trading less, less of it.** Like `minEdgeBps` 23.7: 338 trades, −8.88 bps, reversion 17.2%. Core's bps/trade gets slightly worse (−15.35). It's the weakest R3 row.

## R1 liquidity

**R1-01, `entryZ` 2.5: trading much less, entering only on big stretches that don't revert more.** Trades fall from 370 to 136 and bps/trade improves to −6.65. But the reversion share falls (14.7%), only 20 trades reach the target, and stop exits stay at 11 (now 8% of trades instead of 3%). On Core bps/trade gets *worse* (−17.02). The gain is cost saved on 234 dropped trades. Fails on mechanism.

**R1-02, `entryZ` 1.5: trading more of a thinner edge.** It runs 820 trades on Momentum and 880 on Core. Each stretch is smaller but costs the same ~14 bps, so Momentum drops to −12.66 bps and −$4,863. Bootstrap share is 0. This shows `entryZ` 2 isn't an optimum approached from below.

**R1-03, turn entry: entering later.** It waits for the bar that turns back toward VWAP. Early adverse excursion falls as predicted (18.6 → 15.0 bps), but entering late gives up part of the stretch. Only 23 of 222 trades reach VWAP (reversion 10.4% Momentum, 8.3% Core), and bps/trade is about the baseline (−9.11). The gain is trading less.

## R2 regime

**R2-01, drop SPY/QQQ (pass, weak): trading less by dropping the index names.** Momentum goes to 296 trades and −7.97 bps; reversion rises to 19.9% and gross edge to +6.26 bps (zero-cost twin R2-D4, vs +4.70). On Core, gross edge only moves from −1.08 to −0.77 and bps/trade is flat (−15.07). The Core–Momentum gap widens (5.8 → 7.0 bps). It passes, but the edge left is still far below costs.

**R2-02, `useVwapRegime`: trading less, and the trades left are worse.** Trend-day time stops fall as predicted (65 → 18 on Momentum), but trades fall to 144 and bps/trade drops to −17.26. The time-stop gross goes −14.45 → −27.78. The halves disagree (first half −22.49 $/day, second +52.57), so the net gain isn't stable. Fails on halves.

## R4 exits

**R4-01, stop off (pass, weak): turning stop losses into time-stop losses.** Of the 11 trades the baseline stopped on Momentum, 10 match: 9 now end on the time stop and 1 on target. Those trades lose less (−42.9 → −31.7 bps), but bps/trade only moves −9.52 → −9.17 on 364 trades. The CI touches 0 ([−0.04, 6.36] $/day). On Core the formerly stopped trades lose *more* (−42.7 → −49.2) and the p5 trade worsens (−55.2 → −68.3), a fatter tail. It also admits 3 entries past |z| 3.5.

**R4-02, partway target: cutting winners short.** Win rate rises (45.1 → 51.5%) and avg win falls (+37.1 → +24.8), as predicted. But a partway exit grosses only +12.9 bps on Momentum (+3.3 on Core), below the ~15 bps round trip. Freed capacity adds trades (370 → 400), each about a cost loser: −10.97 bps, −$406.

**R4-03, scale out half: cutting half of each winner short.** The entries are the same 370 trips. Half the position leaves at the partway point for +13.8 bps gross (+3.7 Core), below costs, and the half that rides to VWAP is now smaller. Avg win falls (+37.1 → +30.0), bps/trade drops to −10.00, net −$83, share 0.248.

## R5 portfolio

**R5-01, vol sizing at $5 risk: betting bigger on calm names.** Entries and exits are unchanged, and only sizes move. The dollars go to the calmest names, whose edge barely covers costs. Bps/trade falls to −11.73 (Core −15.48), the cap now binds on 28% / 46% of entries (predicted: down), and the spread of P&L across symbols grows. Fails all five conditions.

**R5-02, crowd split (pass, weak): betting smaller.** Trades, exits and reversion share are identical to the baseline (370, 17.6%). Size shrinks in crowded minutes, and commissions fall from 37.5 to 27.9, about 25% less notional. Cluster-day drawdown falls as predicted (339.57 → 103.33), and bps/trade improves only modestly (−9.52 → −8.05). Much of the +$609 is betting less on a strategy that loses on average. It is risk control, not edge.

## relativeToSpy filter

**RS-01, cutoff 0.5 (pass, weak): mostly the SPY exclusion.** 286 trades, −7.73 bps, reversion 19.9%, β to SPY 0.453 → 0.295. The exclusion-only reference (RS-V3, = R2-01) already gets −7.97 bps on 296 trades. Against it, the filter's own effect is +2.22 $/day with share 0.849, and the halves disagree (−2.59 / +7.03). On Momentum it is mostly trading less again. On Core it is clear (+5.28, share 0.995), but bps/trade there stays at −15.07.

**RS-02, cutoff 0.7 (pass, weak): same story, a bit stronger.** 258 trades, −7.55 bps, β 0.105. Against the reference: +6.14 $/day, share 0.866, halves disagree (−1.32 / +13.60). On Core the filter adds clearly (+16.96, share 1.00; bps −13.58), and it is the best Core row in the batch. Still: −$912 on Momentum.

## The common thread

The strategy's edge before costs is **~+4.7 bps/trade on Momentum and −1.1 on Core** at baseline (D4, D3). The best rows reach about **+6** (R2-D4 +6.26; A07 ≈ +6). Against a **~14–15 bps round trip**, no single switch closes that gap. The changes that "work" do so by **trading less** (R3, R1-01, R1-03, R2-01, RS), **betting smaller** (R5-02) or **swapping one loss for a slightly smaller one** (R4-01). The changes that try to change the trade itself (later entry, earlier exit, regime filter, vol sizing) lose more edge than they save. **Every pass loses less; none makes money**: R2-01 −1,108.59, R4-01 −1,561.09, R5-02 −1,038.37, RS-01 −1,037.56, RS-02 −912.10 (Momentum). That is why the combining step judges steps by net bps/trade (the size-neutral "true test", [MASTER](../MASTER.md#budget-30-configs-split-by-goal)) and not by net dollars.
