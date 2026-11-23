# S4 strategy survey: where weak entry conditions combine

Offline survey, 2026-11-23. **No backtests were run and no rule, config or strategy code was changed.** In-sample dumps only (2026-09-01 → 2026-10-15, 32 days); nothing else was fetched. It doesn't count against the ~30-config budget, but it is a search: [the null comparison](#null-comparison-luck-control) below is the part to read first.

Code: `backend/src/runtime/team3Analysis/` (`sim.ts` exit simulation, `features.ts`, `groups.ts`, `validate.ts`, `survey.ts`), tests in `backend/src/tests/strategy/team3Reversal/team3Analysis.test.ts`. Rerun from `backend/`:
`npx ts-node --transpile-only src/runtime/team3Analysis/validate.ts` then `node -r ts-node/register/transpile-only src/runtime/team3Analysis/survey.ts 200` (about a minute; writes `tmp/team3-data/s4-*.json` and `s4-tables.md`, gitignored).

Dumps used (from `tmp/team3-data/INDEX.md`): V4 cost Core `5a7cd486`, Momentum `bab63751`; V4 zero-cost Core `cbb3b46d`, Momentum `2af1685c`.

## Result in brief

- **The simulation matches V4 exactly**: 370/370 Momentum and 419/419 Core trades, with the same entry bar, z, fill, exit bar and exit reason. Gross bps differ by under 1e-12 bps.
- **V4's own trades (set a): nothing beats luck.** 638 groups tested, 1 flagged; the label-shuffle null flags 1.75 on average (95th percentile 6).
- **The opportunity log (set b): more flags than luck explains.** 671 groups tested, 26 flagged (22 with Core n ≥ 50). The label-shuffle null expects 0.07 (95th pct 1). The circular-shift null, which keeps the clustering of neighbouring bars, expects 3.2 (95th pct 9, max 18 in 200 shuffles). 26 beats both. One caveat: the edge of any single group is only about 2 to 3.3 sigma above its own circular-shift null, so the evidence is for the family of groups, not for any one of them.
- **The signal is one theme: a stock stretched one way while SPY is stretched the other way.** 15 of the 26 flags include `spySameSide = no`, and 1 more is `ownShare > 0.945` (the same idea measured over 30 bars). The crowded-minute flags look strong but sit on 3 to 13 days, with the best day carrying 50 to 81% of the edge sum, so they're episodes, not a rule.
- **Two candidates** worth one entry rule each ([details](#candidates)): **(1)** SPY stretched ≥ 1σ the opposite way and 1–2 VWAP crossings in the last 60 bars: Mom 142 at **+28.2 bps** (halves +44.2 / +22.2), Core 74 at +9.8. **(2)** stock-specific share > 0.945 and day move so far ≤ 47 bps: Mom 549 at **+15.8** (halves +15.7 / +16.2), Core 982 at +1.6. Both are edges before costs against a ~14.2 bps round trip, and both count overlapping bars (see caveats).

## Validation (step 1, before any feature)

Each V4 zero-cost round trip was replayed from its own bars with `sim.ts`. Entry is the next bar's open, the exit is checked on each later bar in the engine's order (close, stop, target, time), and the exit is priced at the exit bar's close (V4's `pnlBpsGross` definition) and, separately, at the next bar's open (the engine's real exit fill).

| | Momentum | Core |
|---|---|---|
| V4 trades (cost dump = zero-cost dump, matched by symbol + entryTs) | 370 = 370 (370 matched) | 419 = 419 (419 matched) |
| entry bar passes the default V4 rule in the sim | 370 | 419 |
| entry z exact / entry fill exact | 370 / 370 | 419 / 419 |
| exit bar match / exit reason match | 370 / 370 | 419 / 419 |
| gross bps within 0.5 bps of `pnlBpsGross` (match rate) | **370 / 370 (100%)** | **419 / 419 (100%)** |
| mean absolute difference, close-priced exit | **2.6e-13 bps** | **3.3e-13 bps** |
| mean absolute difference, next-open exit (engine fill) vs `pnlBpsGross` | 0.65 bps | 0.37 bps |
| mean (next-open − `pnlBpsGross`) | −0.03 bps | +0.02 bps |

One fix was needed on the way. **A dump's `entryTs`/`exitTs` is the decision bar's end (bar start + 1 minute), not the bar's own ts** as `INDEX.md` says. The first pass, which looked up `entryTs` directly, matched only 16/370. After the shift, everything matches. (INDEX.md is in the gitignored data folder and wasn't edited; anyone else indexing `bars` by `entryTs` should subtract 60,000 ms.)

Set (a) uses V4's `pnlBpsGross` (exit-close priced). Set (b) uses the next-open exit as the brief asked. The two differ by 0.03 bps on average, so the 14 bps bar means the same thing on both.

## Data sets

- **(a) V4 trade log**: V4's 370 Momentum and 419 Core trades. Edge = zero-cost `pnlBpsGross`. All have |z| ≥ 2 and "bar moving away from VWAP" by construction, so `absZ` falls in one bin and `turnBar` is always "no" there.
- **(b) Opportunity log**: every regular-session bar in the entry window (minute 15 through 15:44) with 1.5 ≤ |z| < 3.5, fading the stretch. Baseline exit simulated, zero cost, no one-position limit. Momentum 12,204 opportunities at +1.05 bps mean, Core 13,297 at +0.78. None lacked a next bar.
- Halves: H1 = 2026-09-01 → 09-23, H2 = 09-24 → 10-15.

## Features and bin edges (fixed before any outcome was read)

Bins are terciles of the **pooled (Momentum + Core) opportunity log's feature values** (`survey.ts` writes `s4-bins.json` before it reads an edge), or natural cuts for the categorical features. Set (a) uses the same edges. Definitions, all at the signal bar and using only bars up to it:

1. `ownShare`: |r_stock − r_SPY| / |r_stock| over the bars from up to 30 session bars back to now (relativeToSpy's formula, SPY matched by exact ts). n/a for SPY.
2. `absZ`: |z| at entry.
3. `turnBar`: the close moved toward VWAP vs the previous close.
4. `crowded`: ≥ 3 universe symbols (this one included) with z ≥ 2 on the same side at this exact minute.
5. `edgeBps`: |close − VWAP| / close × 1e4.
6. `crossings60`: the engine's own VWAP crossing count over the last 60 session bars.
7. `timeOfDay`: thirds of the entry window, by minute since 9:30 (15–134, 135–254, 255–374).
8. `volRatio`: bar volume ÷ mean volume of up to 30 earlier session bars today.
9. `rangeSigma`: (high − low) ÷ VWAP sigma.
10. `spySameSide`: SPY's z at the same minute. **yes** = |zSPY| ≥ 1 and the same sign as the stock's z; **no** = |zSPY| ≥ 1 and the opposite sign; **neutral** = |zSPY| < 1. n/a for SPY itself (trivially "yes"; a small deviation from the brief, which only named feature 1 as n/a for SPY).
11. `trendBps`: |close − first session open| ÷ first open × 1e4.
12. `stretchRun`: consecutive session bars up to this one with |z| ≥ 1.5 on the same side.

Integer features (6, 12) use floored tercile cuts. In the table below, "zSPY >= 1" in feature 10 means |zSPY| ≥ 1.

| # | Feature | Bin 0 | Bin 1 | Bin 2 |
|---|---|---|---|---|
| 1 | ownShare | <= 0.697 | 0.697 - 0.945 | > 0.945 |
| 2 | absZ | <= 1.674 | 1.674 - 1.947 | > 1.947 |
| 3 | turnBar | no | yes | - |
| 4 | crowded | no | yes | - |
| 5 | edgeBps | <= 41.8 | 41.8 - 79.8 | > 79.8 |
| 6 | crossings60 | <= 0 | 1-2 | >= 3 |
| 7 | timeOfDay | open 9:45-11:44 | mid 11:45-13:44 | late 13:45-15:44 |
| 8 | volRatio | <= 0.742 | 0.742 - 1.113 | > 1.113 |
| 9 | rangeSigma | <= 0.167 | 0.167 - 0.317 | > 0.317 |
| 10 | spySameSide | yes (SPY same side, zSPY >= 1) | no (SPY opposite, zSPY >= 1) | neutral (SPY within 1 sigma) |
| 11 | trendBps | <= 47.1 | 47.1 - 111.1 | > 111.1 |
| 12 | stretchRun | <= 4 | 5-16 | >= 17 |


## Groups, flag rule and nulls

- **Groups**: every single bin; every pair of bins from 2 different features; triples only among the 4 strongest single features. Strength = spread (max − min) of Momentum bin means over bins with ≥ 30 records, measured separately on each data set. Top 4: set (a) `timeOfDay, edgeBps, stretchRun, volRatio`; set (b) `spySameSide, crossings60, absZ, trendBps`.
- **Groups tested**: set (a) **638** (33 singles + 497 pairs + 108 triples; 572 non-empty; 194 with Mom n ≥ 50). Set (b) **671** (34 + 529 + 108; 670 non-empty; 659 with Mom n ≥ 50). Total **1,309**.
- **Flag**: Momentum n ≥ 50, Momentum mean edge ≥ 14 bps, Core mean > 0 (same sign), and both Momentum halves ≥ 0. Variant: also Core n ≥ 50.
- **Nulls, 200 shuffles each, per data set.** The edge values are moved; the features, days and halves stay with their records. In each shuffle the top-4 features are re-picked from the shuffled singles, so the triple search is redone too.
  - *Label shuffle* (as specified): edges permuted at random within each universe.
  - *Circular shift* (added): within each universe, records in symbol-time order, the edge series is rotated by a random offset. Neighbouring set (b) opportunities are mostly the same episode (consecutive bars share most of their exit path), and the label shuffle destroys that clustering. That makes it far too easy to beat. The circular shift keeps the clustering and is the honest null for set (b).
- **Ranking** of flagged groups: z = (group's Momentum mean − its mean under the null) ÷ the null's sd **for that same group** (same members, same size), plus the one-sided empirical p ((1 + #null ≥ actual) / 201; 0.005 is the floor).

The generated tables follow (copied from `s4-tables.md`).

## Tables: set (a) V4 trade log

All records: Momentum 370 at 4.22 bps, Core 419 at -1.10 bps. Halves Momentum 9.90 / -0.45, Core -1.09 / -1.10.

Feature spread (Momentum, max - min bin mean, bins with n >= 30): ownShare 9.11, absZ 0.00, turnBar 0.00, crowded 8.73, edgeBps 11.78, crossings60 7.50, timeOfDay 15.04, volRatio 9.21, rangeSigma 0.00, spySameSide 4.28, trendBps 1.18, stretchRun 11.40. Top 4: timeOfDay, edgeBps, stretchRun, volRatio.

Groups tested: 638 (singles 33, pairs 497, triples 108); non-empty (>= 1 record on either universe): 572; with Momentum n >= 50: 194.

### Single features, set (a)

| Group | Mom n | Mom edge | Mom H1 (n) | Mom H2 (n) | Core n | Core edge | Core H1 / H2 |
|---|---|---|---|---|---|---|---|
| ownShare=<= 0.697 | 68 | 1.63 | 10.53 (22) | -2.63 (46) | 158 | -2.16 | 0.24 / -3.80 |
| ownShare=0.697 - 0.945 | 132 | 4.14 | 2.24 (61) | 5.77 (71) | 98 | -5.47 | -5.04 / -5.87 |
| ownShare=> 0.945 | 96 | 10.74 | 27.64 (50) | -7.63 (46) | 89 | 6.12 | 4.25 / 7.08 |
| absZ=<= 1.674 | 0 | n/a | n/a (0) | n/a (0) | 0 | n/a | n/a / n/a |
| absZ=1.674 - 1.947 | 0 | n/a | n/a (0) | n/a (0) | 0 | n/a | n/a / n/a |
| absZ=> 1.947 | 370 | 4.22 | 9.90 (167) | -0.45 (203) | 419 | -1.10 | -1.09 / -1.10 |
| turnBar=no | 370 | 4.22 | 9.90 (167) | -0.45 (203) | 419 | -1.10 | -1.09 / -1.10 |
| crowded=no | 301 | 5.85 | 9.91 (147) | 1.98 (154) | 322 | -0.63 | 0.45 / -1.36 |
| crowded=yes | 69 | -2.88 | 9.89 (20) | -8.09 (49) | 97 | -2.65 | -5.53 / -0.15 |
| edgeBps=<= 41.8 | 100 | -1.56 | -3.00 (43) | -0.47 (57) | 211 | -3.46 | -5.60 / -1.78 |
| edgeBps=41.8 - 79.8 | 109 | 10.21 | 10.02 (44) | 10.34 (65) | 146 | -2.42 | -1.92 / -2.73 |
| edgeBps=> 79.8 | 161 | 3.76 | 16.78 (80) | -9.10 (81) | 62 | 10.09 | 16.88 / 5.18 |
| crossings60=<= 0 | 123 | 8.27 | 14.37 (54) | 3.51 (69) | 123 | -0.88 | 1.33 / -1.91 |
| crossings60=1-2 | 66 | 6.12 | 27.04 (27) | -8.36 (39) | 62 | 8.16 | 7.78 / 8.39 |
| crossings60=>= 3 | 181 | 0.78 | 1.72 (86) | -0.08 (95) | 234 | -3.66 | -3.72 / -3.61 |
| timeOfDay=open 9:45-11:44 | 203 | 5.14 | 7.07 (96) | 3.42 (107) | 241 | -0.30 | -2.48 / 1.43 |
| timeOfDay=mid 11:45-13:44 | 92 | -3.65 | 9.93 (29) | -9.90 (63) | 101 | -5.30 | -2.10 / -6.66 |
| timeOfDay=late 13:45-15:44 | 75 | 11.39 | 16.38 (42) | 5.04 (33) | 77 | 1.94 | 3.63 / 0.29 |
| volRatio=<= 0.742 | 44 | -3.26 | 4.40 (22) | -10.91 (22) | 79 | -2.07 | -4.67 / 0.33 |
| volRatio=0.742 - 1.113 | 91 | 5.95 | 10.24 (35) | 3.27 (56) | 114 | -2.91 | -5.45 / -1.49 |
| volRatio=> 1.113 | 235 | 4.95 | 10.90 (110) | -0.28 (125) | 226 | 0.16 | 2.19 / -1.34 |
| rangeSigma=<= 0.167 | 25 | 5.98 | 16.10 (10) | -0.77 (15) | 30 | -1.13 | -1.54 / -0.92 |
| rangeSigma=0.167 - 0.317 | 78 | 4.09 | 5.44 (32) | 3.16 (46) | 84 | 2.93 | 8.58 / 0.11 |
| rangeSigma=> 0.317 | 267 | 4.09 | 10.55 (125) | -1.59 (142) | 305 | -2.20 | -3.03 / -1.53 |
| spySameSide=yes (SPY same side, zSPY >= 1) | 176 | 4.82 | 8.38 (72) | 2.36 (104) | 235 | -3.09 | -2.20 / -3.77 |
| spySameSide=no (SPY opposite, zSPY >= 1) | 22 | 35.75 | 63.34 (11) | 8.16 (11) | 19 | 19.62 | 26.51 / 16.44 |
| spySameSide=neutral (SPY within 1 sigma) | 98 | 0.54 | 9.00 (50) | -8.28 (48) | 91 | 0.23 | -0.84 / 0.84 |
| trendBps=<= 47.1 | 131 | 3.89 | 4.08 (64) | 3.72 (67) | 205 | -4.12 | -5.68 / -2.96 |
| trendBps=47.1 - 111.1 | 100 | 3.72 | 13.55 (37) | -2.06 (63) | 145 | 0.03 | 0.83 / -0.59 |
| trendBps=> 111.1 | 139 | 4.89 | 13.51 (66) | -2.90 (73) | 69 | 5.53 | 11.17 / 2.71 |
| stretchRun=<= 4 | 204 | 6.84 | 14.36 (90) | 0.91 (114) | 219 | -2.21 | -1.94 / -2.40 |
| stretchRun=5-16 | 105 | -3.19 | 2.07 (50) | -7.97 (55) | 127 | -2.27 | -3.23 / -1.59 |
| stretchRun=>= 17 | 61 | 8.21 | 9.55 (27) | 7.15 (34) | 73 | 4.28 | 5.31 / 3.57 |

### Top 15 pairs by Momentum edge (Mom n >= 50), set (a)

| Group | Mom n | Mom edge | Mom H1 (n) | Mom H2 (n) | Core n | Core edge | Core H1 / H2 |
|---|---|---|---|---|---|---|---|
| ownShare=> 0.945 & stretchRun=<= 4 | 56 | 19.99 | 38.91 (28) | 1.07 (28) | 46 | 4.77 | 2.51 / 5.86 |
| ownShare=> 0.945 & volRatio=> 1.113 | 63 | 15.49 | 35.60 (33) | -6.64 (30) | 46 | 4.24 | 4.38 / 4.13 |
| ownShare=> 0.945 & rangeSigma=> 0.317 | 73 | 15.39 | 32.63 (39) | -4.39 (34) | 58 | 8.91 | 7.42 / 9.63 |
| crowded=no & edgeBps=41.8 - 79.8 | 91 | 12.92 | 11.97 (37) | 13.57 (54) | 112 | -4.44 | -4.89 / -4.17 |
| ownShare=> 0.945 & timeOfDay=open 9:45-11:44 | 58 | 12.69 | 24.95 (32) | -2.41 (26) | 50 | 10.77 | 9.32 / 11.45 |
| spySameSide=neutral (SPY within 1 sigma) & stretchRun=<= 4 | 56 | 11.93 | 21.47 (29) | 1.67 (27) | 51 | -2.05 | -4.78 / -0.42 |
| edgeBps=41.8 - 79.8 & timeOfDay=open 9:45-11:44 | 67 | 11.85 | 6.11 (29) | 16.23 (38) | 68 | -0.31 | -1.42 / 0.47 |
| edgeBps=41.8 - 79.8 & rangeSigma=> 0.317 | 94 | 11.67 | 9.74 (39) | 13.04 (55) | 91 | -4.99 | -3.06 / -6.58 |
| edgeBps=41.8 - 79.8 & stretchRun=<= 4 | 80 | 11.54 | 11.47 (35) | 11.60 (45) | 65 | -1.22 | -0.16 / -2.08 |
| absZ=> 1.947 & timeOfDay=late 13:45-15:44 | 75 | 11.39 | 16.38 (42) | 5.04 (33) | 77 | 1.94 | 3.63 / 0.29 |
| turnBar=no & timeOfDay=late 13:45-15:44 | 75 | 11.39 | 16.38 (42) | 5.04 (33) | 77 | 1.94 | 3.63 / 0.29 |
| crowded=no & timeOfDay=late 13:45-15:44 | 65 | 10.96 | 17.07 (32) | 5.04 (33) | 57 | 4.77 | 14.47 / 0.29 |
| ownShare=0.697 - 0.945 & crossings60=<= 0 | 54 | 10.93 | 7.10 (23) | 13.77 (31) | 29 | -1.86 | 5.36 / -5.11 |
| ownShare=> 0.945 & absZ=> 1.947 | 96 | 10.74 | 27.64 (50) | -7.63 (46) | 89 | 6.12 | 4.25 / 7.08 |
| ownShare=> 0.945 & turnBar=no | 96 | 10.74 | 27.64 (50) | -7.63 (46) | 89 | 6.12 | 4.25 / 7.08 |

### Top 10 triples by Momentum edge (Mom n >= 50), set (a)

| Group | Mom n | Mom edge | Mom H1 (n) | Mom H2 (n) | Core n | Core edge | Core H1 / H2 |
|---|---|---|---|---|---|---|---|
| timeOfDay=open 9:45-11:44 & volRatio=> 1.113 & stretchRun=<= 4 | 85 | 12.09 | 16.40 (41) | 8.07 (44) | 80 | -3.12 | -3.49 / -2.78 |
| edgeBps=41.8 - 79.8 & volRatio=> 1.113 & stretchRun=<= 4 | 55 | 10.48 | 9.58 (20) | 11.00 (35) | 48 | -2.33 | -1.69 / -2.91 |
| edgeBps=41.8 - 79.8 & timeOfDay=open 9:45-11:44 & stretchRun=<= 4 | 60 | 9.95 | 5.21 (27) | 13.82 (33) | 44 | -0.64 | 1.75 / -2.82 |
| edgeBps=> 79.8 & volRatio=> 1.113 & stretchRun=<= 4 | 51 | 5.82 | 24.54 (30) | -20.93 (21) | 6 | 43.76 | 54.20 / 22.88 |

### Flagged, set (a): 1 groups (Mom n >= 50, Mom edge >= 14, Core > 0, both Mom halves >= 0), ranked by z vs the label-shuffle null of the same group

| Group | Mom n | Mom edge | Mom H1 (n) | Mom H2 (n) | Core n | Core edge | Core H1 / H2 | z (label) | p (label) | z (circ) | p (circ) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ownShare=> 0.945 & stretchRun=<= 4 | 56 | 19.99 | 38.91 (28) | 1.07 (28) | 46 | 4.77 | 2.51 / 5.86 | 2.51 | 0.010 | 2.37 | 0.015 |

### Flagged with Core n >= 50 too, set (a): 0 groups

| Group | Mom n | Mom edge | Mom H1 (n) | Mom H2 (n) | Core n | Core edge | Core H1 / H2 | z (label) | p (label) | z (circ) | p (circ) |
|---|---|---|---|---|---|---|---|---|---|---|---|

### Concentration of the flagged groups, set (a), Momentum

| Group | Mom n | days | symbol-days | runs (consecutive-bar episodes) | best day's share of edge sum | Mom edge without best day | Core days |
|---|---|---|---|---|---|---|---|
| ownShare=> 0.945 & stretchRun=<= 4 | 56 | 26 | 48 | 56 | 0.19 | 17.16 | 23 |

### Null, set (a), 200 shuffles each

- Label shuffle, flags: mean 1.75, median 1.0, 95th pct 6.0, max 11, share of shuffles with >= actual 0.675 (actual 1)
- Label shuffle, flags with Core n >= 50: mean 1.27, median 1.0, 95th pct 5.0, max 10, share of shuffles with >= actual 1.000 (actual 0)
- Circular shift, flags: mean 2.42, median 1.0, 95th pct 8.0, max 23, share of shuffles with >= actual 0.690 (actual 1)
- Circular shift, flags with Core n >= 50: mean 1.61, median 1.0, 95th pct 5.0, max 14, share of shuffles with >= actual 1.000 (actual 0)

## Tables: set (b) opportunity log

All records: Momentum 12204 at 1.05 bps, Core 13297 at 0.78 bps. Halves Momentum 1.57 / 0.60, Core 1.20 / 0.47.

Feature spread (Momentum, max - min bin mean, bins with n >= 30): ownShare 3.60, absZ 4.59, turnBar 0.41, crowded 3.09, edgeBps 4.12, crossings60 4.84, timeOfDay 3.94, volRatio 1.55, rangeSigma 1.42, spySameSide 13.82, trendBps 4.53, stretchRun 1.03. Top 4: spySameSide, crossings60, absZ, trendBps.

Groups tested: 671 (singles 34, pairs 529, triples 108); non-empty (>= 1 record on either universe): 670; with Momentum n >= 50: 659.

### Single features, set (b)

| Group | Mom n | Mom edge | Mom H1 (n) | Mom H2 (n) | Core n | Core edge | Core H1 / H2 |
|---|---|---|---|---|---|---|---|
| ownShare=<= 0.697 | 2223 | 1.88 | -1.77 (929) | 4.50 (1294) | 4464 | 0.76 | 2.61 / -0.59 |
| ownShare=0.697 - 0.945 | 3732 | -0.57 | 1.50 (1647) | -2.20 (2085) | 2954 | 0.65 | 0.27 / 0.95 |
| ownShare=> 0.945 | 3529 | 3.03 | 4.73 (1894) | 1.06 (1635) | 3158 | 1.63 | 1.97 / 1.42 |
| absZ=<= 1.674 | 4242 | 0.24 | 0.41 (2030) | 0.09 (2212) | 4259 | 1.04 | 1.42 / 0.77 |
| absZ=1.674 - 1.947 | 4173 | -0.71 | -2.78 (2002) | 1.20 (2171) | 4327 | 0.89 | 2.01 / 0.10 |
| absZ=> 1.947 | 3789 | 3.88 | 8.35 (1631) | 0.51 (2158) | 4711 | 0.44 | 0.32 / 0.54 |
| turnBar=no | 7670 | 0.90 | 1.80 (3564) | 0.11 (4106) | 8397 | 0.81 | 1.08 / 0.61 |
| turnBar=yes | 4534 | 1.31 | 1.18 (2099) | 1.41 (2435) | 4900 | 0.72 | 1.43 / 0.23 |
| crowded=no | 11317 | 0.82 | 0.46 (5423) | 1.16 (5894) | 12207 | 1.02 | 1.68 / 0.57 |
| crowded=yes | 887 | 3.91 | 26.70 (240) | -4.54 (647) | 1090 | -1.99 | -2.88 / -0.94 |
| edgeBps=<= 41.8 | 3039 | -0.41 | -1.84 (1254) | 0.59 (1785) | 5463 | -0.09 | 0.05 / -0.19 |
| edgeBps=41.8 - 79.8 | 3146 | 3.70 | 5.75 (1351) | 2.16 (1795) | 5353 | -0.58 | -1.53 / 0.05 |
| edgeBps=> 79.8 | 6019 | 0.40 | 1.12 (3058) | -0.35 (2961) | 2481 | 5.62 | 8.51 / 3.08 |
| crossings60=<= 0 | 7000 | 0.99 | -0.80 (3325) | 2.62 (3675) | 7139 | 1.02 | 2.16 / 0.37 |
| crossings60=1-2 | 1722 | 4.36 | 10.49 (611) | 0.99 (1111) | 1828 | 4.33 | 3.51 / 5.00 |
| crossings60=>= 3 | 3482 | -0.48 | 2.98 (1727) | -3.89 (1755) | 4330 | -1.12 | -0.77 / -1.48 |
| timeOfDay=open 9:45-11:44 | 4453 | 1.75 | 3.90 (2173) | -0.30 (2280) | 5336 | 0.76 | 0.34 / 1.18 |
| timeOfDay=mid 11:45-13:44 | 4086 | -1.22 | -1.11 (1768) | -1.31 (2318) | 4337 | -1.31 | -1.65 / -1.12 |
| timeOfDay=late 13:45-15:44 | 3665 | 2.72 | 1.38 (1722) | 3.91 (1943) | 3624 | 3.30 | 6.07 / 1.57 |
| volRatio=<= 0.742 | 3845 | 1.80 | 1.24 (1845) | 2.33 (2000) | 4656 | 0.01 | -0.48 / 0.38 |
| volRatio=0.742 - 1.113 | 4188 | 1.14 | 1.61 (1917) | 0.74 (2271) | 4312 | 0.89 | 1.55 / 0.43 |
| volRatio=> 1.113 | 4171 | 0.26 | 1.85 (1901) | -1.07 (2270) | 4329 | 1.49 | 2.75 / 0.60 |
| rangeSigma=<= 0.167 | 4108 | 0.23 | -4.15 (2014) | 4.45 (2094) | 4393 | 1.55 | 1.74 / 1.43 |
| rangeSigma=0.167 - 0.317 | 4131 | 1.66 | 2.60 (1837) | 0.90 (2294) | 4369 | 2.15 | 3.39 / 1.28 |
| rangeSigma=> 0.317 | 3965 | 1.26 | 6.88 (1812) | -3.47 (2153) | 4535 | -1.29 | -1.19 / -1.37 |
| spySameSide=yes (SPY same side, zSPY >= 1) | 5393 | 1.13 | -0.01 (2419) | 2.06 (2974) | 7147 | 0.27 | 0.22 / 0.30 |
| spySameSide=no (SPY opposite, zSPY >= 1) | 607 | 13.44 | 27.59 (239) | 4.24 (368) | 465 | 6.87 | 14.18 / 3.84 |
| spySameSide=neutral (SPY within 1 sigma) | 3493 | -0.38 | 1.78 (1815) | -2.72 (1678) | 2974 | 1.80 | 3.99 / 0.19 |
| trendBps=<= 47.1 | 3327 | 2.00 | 2.33 (1627) | 1.68 (1700) | 5174 | 0.17 | -0.53 / 0.68 |
| trendBps=47.1 - 111.1 | 3598 | 3.38 | 6.68 (1456) | 1.14 (2142) | 4902 | -0.76 | -1.46 / -0.23 |
| trendBps=> 111.1 | 5279 | -1.14 | -1.80 (2580) | -0.52 (2699) | 3221 | 4.09 | 8.24 / 1.16 |
| stretchRun=<= 4 | 4235 | 0.57 | 2.80 (1956) | -1.34 (2279) | 4501 | 0.38 | 1.95 / -0.81 |
| stretchRun=5-16 | 4051 | 1.01 | 3.59 (1851) | -1.15 (2200) | 4269 | -0.83 | -1.63 / -0.24 |
| stretchRun=>= 17 | 3918 | 1.60 | -1.74 (1856) | 4.61 (2062) | 4527 | 2.69 | 3.17 / 2.35 |

### Top 15 pairs by Momentum edge (Mom n >= 50), set (b)

| Group | Mom n | Mom edge | Mom H1 (n) | Mom H2 (n) | Core n | Core edge | Core H1 / H2 |
|---|---|---|---|---|---|---|---|
| crossings60=1-2 & spySameSide=no (SPY opposite, zSPY >= 1) | 142 | 28.22 | 44.23 (39) | 22.16 (103) | 74 | 9.79 | 38.92 / 4.70 |
| crowded=yes & timeOfDay=late 13:45-15:44 | 175 | 28.08 | 25.48 (167) | 82.48 (8) | 266 | 6.21 | 6.12 / 11.91 |
| absZ=> 1.947 & spySameSide=no (SPY opposite, zSPY >= 1) | 130 | 26.50 | 45.10 (72) | 3.42 (58) | 118 | 11.42 | 19.17 / 8.15 |
| crowded=yes & stretchRun=>= 17 | 353 | 21.80 | 50.93 (91) | 11.68 (262) | 414 | 8.42 | 10.50 / 5.35 |
| crowded=yes & rangeSigma=<= 0.167 | 86 | 19.74 | 53.70 (21) | 8.77 (65) | 67 | 17.13 | 29.61 / 10.60 |
| crowded=yes & volRatio=<= 0.742 | 170 | 17.93 | 52.27 (41) | 7.02 (129) | 273 | -16.02 | -25.55 / -1.47 |
| volRatio=> 1.113 & spySameSide=no (SPY opposite, zSPY >= 1) | 225 | 17.57 | 32.08 (84) | 8.93 (141) | 141 | 5.74 | 12.03 / 2.89 |
| crowded=yes & crossings60=<= 0 | 278 | 17.01 | 81.06 (56) | 0.86 (222) | 214 | 6.38 | 2.81 / 8.59 |
| rangeSigma=> 0.317 & spySameSide=no (SPY opposite, zSPY >= 1) | 328 | 16.92 | 27.50 (169) | 5.67 (159) | 232 | 9.92 | 19.74 / 4.96 |
| crowded=yes & rangeSigma=0.167 - 0.317 | 309 | 16.56 | 48.69 (79) | 5.53 (230) | 310 | 11.61 | 18.34 / 5.46 |
| spySameSide=no (SPY opposite, zSPY >= 1) & stretchRun=5-16 | 207 | 16.06 | 28.70 (90) | 6.34 (117) | 162 | 9.28 | 13.65 / 7.55 |
| ownShare=> 0.945 & trendBps=<= 47.1 | 549 | 15.84 | 15.65 (350) | 16.19 (199) | 982 | 1.59 | 0.42 / 2.08 |
| edgeBps=> 79.8 & spySameSide=no (SPY opposite, zSPY >= 1) | 260 | 15.26 | 40.72 (109) | -3.12 (151) | 44 | 6.78 | 25.65 / -0.29 |
| turnBar=no & spySameSide=no (SPY opposite, zSPY >= 1) | 405 | 15.23 | 28.47 (160) | 6.58 (245) | 305 | 8.92 | 15.12 / 6.07 |
| ownShare=> 0.945 & spySameSide=no (SPY opposite, zSPY >= 1) | 561 | 14.68 | 28.08 (236) | 4.94 (325) | 398 | 6.91 | 14.73 / 3.65 |

### Top 10 triples by Momentum edge (Mom n >= 50), set (b)

| Group | Mom n | Mom edge | Mom H1 (n) | Mom H2 (n) | Core n | Core edge | Core H1 / H2 |
|---|---|---|---|---|---|---|---|
| absZ=> 1.947 & spySameSide=no (SPY opposite, zSPY >= 1) & trendBps=> 111.1 | 55 | 38.57 | 61.45 (35) | -1.48 (20) | 13 | 26.93 | 88.73 / 21.78 |
| crossings60=1-2 & spySameSide=no (SPY opposite, zSPY >= 1) & trendBps=> 111.1 | 58 | 33.31 | 58.82 (25) | 13.98 (33) | 4 | 34.31 | 73.50 / -83.26 |
| crossings60=1-2 & spySameSide=neutral (SPY within 1 sigma) & trendBps=<= 47.1 | 95 | 30.38 | 21.45 (56) | 43.20 (39) | 109 | 7.55 | 19.34 / -4.03 |
| absZ=1.674 - 1.947 & crossings60=1-2 & spySameSide=no (SPY opposite, zSPY >= 1) | 54 | 28.55 | 36.00 (14) | 25.95 (40) | 35 | 12.70 | 31.98 / 8.72 |
| absZ=> 1.947 & crossings60=>= 3 & spySameSide=no (SPY opposite, zSPY >= 1) | 73 | 22.78 | 39.91 (53) | -22.60 (20) | 65 | 13.57 | 16.06 / 11.30 |
| crossings60=1-2 & spySameSide=no (SPY opposite, zSPY >= 1) & trendBps=47.1 - 111.1 | 59 | 22.64 | 21.39 (12) | 22.96 (47) | 17 | 8.75 | 3.23 / 10.45 |
| absZ=> 1.947 & crossings60=1-2 & spySameSide=neutral (SPY within 1 sigma) | 118 | 22.08 | 7.89 (28) | 26.49 (90) | 95 | 15.54 | 19.21 / 9.79 |
| absZ=<= 1.674 & crossings60=>= 3 & spySameSide=no (SPY opposite, zSPY >= 1) | 84 | 19.22 | 25.96 (46) | 11.05 (38) | 63 | 7.57 | 8.30 / 7.06 |
| crossings60=<= 0 & spySameSide=yes (SPY same side, zSPY >= 1) & trendBps=<= 47.1 | 185 | 18.65 | 16.50 (145) | 26.44 (40) | 705 | -1.18 | 1.35 / -2.12 |
| absZ=<= 1.674 & crossings60=1-2 & spySameSide=no (SPY opposite, zSPY >= 1) | 64 | 18.02 | 26.98 (15) | 15.27 (49) | 31 | 2.29 | 47.25 / -6.35 |

### Flagged, set (b): 26 groups (Mom n >= 50, Mom edge >= 14, Core > 0, both Mom halves >= 0), ranked by z vs the label-shuffle null of the same group

| Group | Mom n | Mom edge | Mom H1 (n) | Mom H2 (n) | Core n | Core edge | Core H1 / H2 | z (label) | p (label) | z (circ) | p (circ) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| crowded=yes & stretchRun=>= 17 | 353 | 21.80 | 50.93 (91) | 11.68 (262) | 414 | 8.42 | 10.50 / 5.35 | 9.32 | 0.005 | 2.97 | 0.005 |
| crowded=yes & timeOfDay=late 13:45-15:44 | 175 | 28.08 | 25.48 (167) | 82.48 (8) | 266 | 6.21 | 6.12 / 11.91 | 7.86 | 0.005 | 2.27 | 0.005 |
| ownShare=> 0.945 & trendBps=<= 47.1 | 549 | 15.84 | 15.65 (350) | 16.19 (199) | 982 | 1.59 | 0.42 / 2.08 | 7.80 | 0.005 | 2.67 | 0.005 |
| crossings60=1-2 & spySameSide=no (SPY opposite, zSPY >= 1) | 142 | 28.22 | 44.23 (39) | 22.16 (103) | 74 | 9.79 | 38.92 / 4.70 | 7.12 | 0.005 | 3.29 | 0.010 |
| ownShare=> 0.945 & spySameSide=no (SPY opposite, zSPY >= 1) | 561 | 14.68 | 28.08 (236) | 4.94 (325) | 398 | 6.91 | 14.73 / 3.65 | 7.08 | 0.005 | 2.71 | 0.005 |
| crossings60=1-2 & spySameSide=neutral (SPY within 1 sigma) & trendBps=<= 47.1 | 95 | 30.38 | 21.45 (56) | 43.20 (39) | 109 | 7.55 | 19.34 / -4.03 | 6.86 | 0.005 | 2.81 | 0.005 |
| rangeSigma=> 0.317 & spySameSide=no (SPY opposite, zSPY >= 1) | 328 | 16.92 | 27.50 (169) | 5.67 (159) | 232 | 9.92 | 19.74 / 4.96 | 6.55 | 0.005 | 3.01 | 0.005 |
| turnBar=no & spySameSide=no (SPY opposite, zSPY >= 1) | 405 | 15.23 | 28.47 (160) | 6.58 (245) | 305 | 8.92 | 15.12 / 6.07 | 6.47 | 0.005 | 2.79 | 0.005 |
| crowded=yes & rangeSigma=0.167 - 0.317 | 309 | 16.56 | 48.69 (79) | 5.53 (230) | 310 | 11.61 | 18.34 / 5.46 | 6.45 | 0.005 | 3.06 | 0.005 |
| crossings60=1-2 & spySameSide=no (SPY opposite, zSPY >= 1) & trendBps=> 111.1 | 58 | 33.31 | 58.82 (25) | 13.98 (33) | 4 | 34.31 | 73.50 / -83.26 | 6.27 | 0.005 | 2.59 | 0.020 |
| absZ=> 1.947 & spySameSide=no (SPY opposite, zSPY >= 1) | 130 | 26.50 | 45.10 (72) | 3.42 (58) | 118 | 11.42 | 19.17 / 8.15 | 6.10 | 0.005 | 2.99 | 0.005 |
| timeOfDay=open 9:45-11:44 & spySameSide=no (SPY opposite, zSPY >= 1) | 386 | 14.41 | 28.64 (194) | 0.04 (192) | 231 | 10.55 | 22.53 / 4.20 | 5.74 | 0.005 | 2.21 | 0.015 |
| crowded=yes & crossings60=<= 0 | 278 | 17.01 | 81.06 (56) | 0.86 (222) | 214 | 6.38 | 2.81 / 8.59 | 5.71 | 0.005 | 2.19 | 0.020 |
| absZ=> 1.947 & crossings60=1-2 & spySameSide=neutral (SPY within 1 sigma) | 118 | 22.08 | 7.89 (28) | 26.49 (90) | 95 | 15.54 | 19.21 / 9.79 | 5.51 | 0.005 | 2.29 | 0.025 |
| volRatio=> 1.113 & spySameSide=no (SPY opposite, zSPY >= 1) | 225 | 17.57 | 32.08 (84) | 8.93 (141) | 141 | 5.74 | 12.03 / 2.89 | 5.48 | 0.005 | 2.90 | 0.005 |
| crossings60=1-2 & timeOfDay=late 13:45-15:44 | 250 | 14.20 | 22.24 (120) | 6.78 (130) | 151 | 31.36 | 38.20 / 14.73 | 4.52 | 0.005 | 1.50 | 0.050 |
| absZ=1.674 - 1.947 & crossings60=1-2 & spySameSide=no (SPY opposite, zSPY >= 1) | 54 | 28.55 | 36.00 (14) | 25.95 (40) | 35 | 12.70 | 31.98 / 8.72 | 4.49 | 0.005 | 2.68 | 0.010 |
| spySameSide=no (SPY opposite, zSPY >= 1) & stretchRun=5-16 | 207 | 16.06 | 28.70 (90) | 6.34 (117) | 162 | 9.28 | 13.65 / 7.55 | 4.40 | 0.005 | 2.35 | 0.005 |
| crowded=yes & rangeSigma=<= 0.167 | 86 | 19.74 | 53.70 (21) | 8.77 (65) | 67 | 17.13 | 29.61 / 10.60 | 3.96 | 0.005 | 2.59 | 0.005 |
| absZ=1.674 - 1.947 & crossings60=1-2 & trendBps=47.1 - 111.1 | 181 | 14.80 | 15.33 (57) | 14.55 (124) | 244 | 5.01 | 2.00 / 7.18 | 3.87 | 0.005 | 1.96 | 0.015 |
| spySameSide=no (SPY opposite, zSPY >= 1) & trendBps=47.1 - 111.1 | 202 | 14.02 | 34.22 (58) | 5.88 (144) | 221 | 5.78 | 12.28 / 3.92 | 3.86 | 0.005 | 1.77 | 0.035 |
| absZ=> 1.947 & spySameSide=neutral (SPY within 1 sigma) & trendBps=<= 47.1 | 116 | 16.33 | 15.40 (51) | 17.06 (65) | 247 | 3.45 | 6.37 / 1.11 | 3.64 | 0.005 | 1.48 | 0.065 |
| crossings60=1-2 & spySameSide=no (SPY opposite, zSPY >= 1) & trendBps=47.1 - 111.1 | 59 | 22.64 | 21.39 (12) | 22.96 (47) | 17 | 8.75 | 3.23 / 10.45 | 3.53 | 0.005 | 1.59 | 0.040 |
| absZ=<= 1.674 & crossings60=>= 3 & spySameSide=no (SPY opposite, zSPY >= 1) | 84 | 19.22 | 25.96 (46) | 11.05 (38) | 63 | 7.57 | 8.30 / 7.06 | 3.48 | 0.005 | 2.55 | 0.010 |
| absZ=<= 1.674 & crossings60=1-2 & spySameSide=no (SPY opposite, zSPY >= 1) | 64 | 18.02 | 26.98 (15) | 15.27 (49) | 31 | 2.29 | 47.25 / -6.35 | 3.04 | 0.005 | 1.89 | 0.025 |
| absZ=1.674 - 1.947 & spySameSide=no (SPY opposite, zSPY >= 1) & trendBps=47.1 - 111.1 | 82 | 14.18 | 44.56 (19) | 5.01 (63) | 82 | 7.09 | 14.23 / 5.36 | 2.38 | 0.015 | 1.34 | 0.070 |

### Flagged with Core n >= 50 too, set (b): 22 groups

| Group | Mom n | Mom edge | Mom H1 (n) | Mom H2 (n) | Core n | Core edge | Core H1 / H2 | z (label) | p (label) | z (circ) | p (circ) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| crowded=yes & stretchRun=>= 17 | 353 | 21.80 | 50.93 (91) | 11.68 (262) | 414 | 8.42 | 10.50 / 5.35 | 9.32 | 0.005 | 2.97 | 0.005 |
| crowded=yes & timeOfDay=late 13:45-15:44 | 175 | 28.08 | 25.48 (167) | 82.48 (8) | 266 | 6.21 | 6.12 / 11.91 | 7.86 | 0.005 | 2.27 | 0.005 |
| ownShare=> 0.945 & trendBps=<= 47.1 | 549 | 15.84 | 15.65 (350) | 16.19 (199) | 982 | 1.59 | 0.42 / 2.08 | 7.80 | 0.005 | 2.67 | 0.005 |
| crossings60=1-2 & spySameSide=no (SPY opposite, zSPY >= 1) | 142 | 28.22 | 44.23 (39) | 22.16 (103) | 74 | 9.79 | 38.92 / 4.70 | 7.12 | 0.005 | 3.29 | 0.010 |
| ownShare=> 0.945 & spySameSide=no (SPY opposite, zSPY >= 1) | 561 | 14.68 | 28.08 (236) | 4.94 (325) | 398 | 6.91 | 14.73 / 3.65 | 7.08 | 0.005 | 2.71 | 0.005 |
| crossings60=1-2 & spySameSide=neutral (SPY within 1 sigma) & trendBps=<= 47.1 | 95 | 30.38 | 21.45 (56) | 43.20 (39) | 109 | 7.55 | 19.34 / -4.03 | 6.86 | 0.005 | 2.81 | 0.005 |
| rangeSigma=> 0.317 & spySameSide=no (SPY opposite, zSPY >= 1) | 328 | 16.92 | 27.50 (169) | 5.67 (159) | 232 | 9.92 | 19.74 / 4.96 | 6.55 | 0.005 | 3.01 | 0.005 |
| turnBar=no & spySameSide=no (SPY opposite, zSPY >= 1) | 405 | 15.23 | 28.47 (160) | 6.58 (245) | 305 | 8.92 | 15.12 / 6.07 | 6.47 | 0.005 | 2.79 | 0.005 |
| crowded=yes & rangeSigma=0.167 - 0.317 | 309 | 16.56 | 48.69 (79) | 5.53 (230) | 310 | 11.61 | 18.34 / 5.46 | 6.45 | 0.005 | 3.06 | 0.005 |
| absZ=> 1.947 & spySameSide=no (SPY opposite, zSPY >= 1) | 130 | 26.50 | 45.10 (72) | 3.42 (58) | 118 | 11.42 | 19.17 / 8.15 | 6.10 | 0.005 | 2.99 | 0.005 |
| timeOfDay=open 9:45-11:44 & spySameSide=no (SPY opposite, zSPY >= 1) | 386 | 14.41 | 28.64 (194) | 0.04 (192) | 231 | 10.55 | 22.53 / 4.20 | 5.74 | 0.005 | 2.21 | 0.015 |
| crowded=yes & crossings60=<= 0 | 278 | 17.01 | 81.06 (56) | 0.86 (222) | 214 | 6.38 | 2.81 / 8.59 | 5.71 | 0.005 | 2.19 | 0.020 |
| absZ=> 1.947 & crossings60=1-2 & spySameSide=neutral (SPY within 1 sigma) | 118 | 22.08 | 7.89 (28) | 26.49 (90) | 95 | 15.54 | 19.21 / 9.79 | 5.51 | 0.005 | 2.29 | 0.025 |
| volRatio=> 1.113 & spySameSide=no (SPY opposite, zSPY >= 1) | 225 | 17.57 | 32.08 (84) | 8.93 (141) | 141 | 5.74 | 12.03 / 2.89 | 5.48 | 0.005 | 2.90 | 0.005 |
| crossings60=1-2 & timeOfDay=late 13:45-15:44 | 250 | 14.20 | 22.24 (120) | 6.78 (130) | 151 | 31.36 | 38.20 / 14.73 | 4.52 | 0.005 | 1.50 | 0.050 |
| spySameSide=no (SPY opposite, zSPY >= 1) & stretchRun=5-16 | 207 | 16.06 | 28.70 (90) | 6.34 (117) | 162 | 9.28 | 13.65 / 7.55 | 4.40 | 0.005 | 2.35 | 0.005 |
| crowded=yes & rangeSigma=<= 0.167 | 86 | 19.74 | 53.70 (21) | 8.77 (65) | 67 | 17.13 | 29.61 / 10.60 | 3.96 | 0.005 | 2.59 | 0.005 |
| absZ=1.674 - 1.947 & crossings60=1-2 & trendBps=47.1 - 111.1 | 181 | 14.80 | 15.33 (57) | 14.55 (124) | 244 | 5.01 | 2.00 / 7.18 | 3.87 | 0.005 | 1.96 | 0.015 |
| spySameSide=no (SPY opposite, zSPY >= 1) & trendBps=47.1 - 111.1 | 202 | 14.02 | 34.22 (58) | 5.88 (144) | 221 | 5.78 | 12.28 / 3.92 | 3.86 | 0.005 | 1.77 | 0.035 |
| absZ=> 1.947 & spySameSide=neutral (SPY within 1 sigma) & trendBps=<= 47.1 | 116 | 16.33 | 15.40 (51) | 17.06 (65) | 247 | 3.45 | 6.37 / 1.11 | 3.64 | 0.005 | 1.48 | 0.065 |
| absZ=<= 1.674 & crossings60=>= 3 & spySameSide=no (SPY opposite, zSPY >= 1) | 84 | 19.22 | 25.96 (46) | 11.05 (38) | 63 | 7.57 | 8.30 / 7.06 | 3.48 | 0.005 | 2.55 | 0.010 |
| absZ=1.674 - 1.947 & spySameSide=no (SPY opposite, zSPY >= 1) & trendBps=47.1 - 111.1 | 82 | 14.18 | 44.56 (19) | 5.01 (63) | 82 | 7.09 | 14.23 / 5.36 | 2.38 | 0.015 | 1.34 | 0.070 |

### Concentration of the flagged groups, set (b), Momentum

| Group | Mom n | days | symbol-days | runs (consecutive-bar episodes) | best day's share of edge sum | Mom edge without best day | Core days |
|---|---|---|---|---|---|---|---|
| ownShare=> 0.945 & spySameSide=no (SPY opposite, zSPY >= 1) | 561 | 30 | 75 | 202 | 0.16 | 13.56 | 22 |
| ownShare=> 0.945 & trendBps=<= 47.1 | 549 | 29 | 65 | 195 | 0.16 | 14.01 | 31 |
| absZ=> 1.947 & spySameSide=no (SPY opposite, zSPY >= 1) | 130 | 23 | 35 | 61 | 0.31 | 21.33 | 16 |
| turnBar=no & spySameSide=no (SPY opposite, zSPY >= 1) | 405 | 29 | 73 | 262 | 0.14 | 14.24 | 21 |
| crowded=yes & crossings60=<= 0 | 278 | 10 | 25 | 59 | 0.65 | 6.83 | 12 |
| crowded=yes & timeOfDay=late 13:45-15:44 | 175 | 3 | 14 | 35 | 0.81 | 79.43 | 4 |
| crowded=yes & rangeSigma=<= 0.167 | 86 | 9 | 29 | 70 | 0.50 | 11.60 | 13 |
| crowded=yes & rangeSigma=0.167 - 0.317 | 309 | 13 | 48 | 194 | 0.51 | 9.86 | 18 |
| crowded=yes & stretchRun=>= 17 | 353 | 9 | 33 | 69 | 0.50 | 14.01 | 17 |
| crossings60=1-2 & timeOfDay=late 13:45-15:44 | 250 | 18 | 26 | 56 | 0.41 | 10.75 | 12 |
| crossings60=1-2 & spySameSide=no (SPY opposite, zSPY >= 1) | 142 | 18 | 27 | 61 | 0.20 | 26.86 | 12 |
| timeOfDay=open 9:45-11:44 & spySameSide=no (SPY opposite, zSPY >= 1) | 386 | 29 | 65 | 150 | 0.18 | 12.95 | 19 |
| volRatio=> 1.113 & spySameSide=no (SPY opposite, zSPY >= 1) | 225 | 27 | 55 | 150 | 0.19 | 18.14 | 17 |
| rangeSigma=> 0.317 & spySameSide=no (SPY opposite, zSPY >= 1) | 328 | 29 | 70 | 190 | 0.15 | 15.79 | 21 |
| spySameSide=no (SPY opposite, zSPY >= 1) & trendBps=47.1 - 111.1 | 202 | 21 | 36 | 84 | 0.28 | 11.09 | 17 |
| spySameSide=no (SPY opposite, zSPY >= 1) & stretchRun=5-16 | 207 | 20 | 39 | 69 | 0.29 | 12.94 | 13 |
| absZ=<= 1.674 & crossings60=1-2 & spySameSide=no (SPY opposite, zSPY >= 1) | 64 | 16 | 23 | 47 | 0.37 | 14.18 | 9 |
| absZ=<= 1.674 & crossings60=>= 3 & spySameSide=no (SPY opposite, zSPY >= 1) | 84 | 26 | 36 | 68 | 0.25 | 15.73 | 17 |
| absZ=1.674 - 1.947 & crossings60=1-2 & spySameSide=no (SPY opposite, zSPY >= 1) | 54 | 12 | 17 | 37 | 0.22 | 26.58 | 7 |
| absZ=> 1.947 & crossings60=1-2 & spySameSide=neutral (SPY within 1 sigma) | 118 | 16 | 26 | 35 | 0.76 | 7.05 | 20 |
| absZ=1.674 - 1.947 & crossings60=1-2 & trendBps=47.1 - 111.1 | 181 | 21 | 40 | 105 | 0.30 | 12.59 | 28 |
| absZ=1.674 - 1.947 & spySameSide=no (SPY opposite, zSPY >= 1) & trendBps=47.1 - 111.1 | 82 | 17 | 24 | 46 | 0.24 | 11.63 | 10 |
| absZ=> 1.947 & spySameSide=neutral (SPY within 1 sigma) & trendBps=<= 47.1 | 116 | 21 | 25 | 56 | 0.44 | 10.55 | 25 |
| crossings60=1-2 & spySameSide=no (SPY opposite, zSPY >= 1) & trendBps=47.1 - 111.1 | 59 | 12 | 14 | 25 | 0.32 | 20.13 | 5 |
| crossings60=1-2 & spySameSide=no (SPY opposite, zSPY >= 1) & trendBps=> 111.1 | 58 | 12 | 17 | 34 | 0.34 | 24.87 | 2 |
| crossings60=1-2 & spySameSide=neutral (SPY within 1 sigma) & trendBps=<= 47.1 | 95 | 15 | 18 | 33 | 0.23 | 27.70 | 16 |

### Null, set (b), 200 shuffles each

- Label shuffle, flags: mean 0.07, median 0.0, 95th pct 1.0, max 1, share of shuffles with >= actual 0.000 (actual 26)
- Label shuffle, flags with Core n >= 50: mean 0.06, median 0.0, 95th pct 1.0, max 1, share of shuffles with >= actual 0.000 (actual 22)
- Circular shift, flags: mean 3.23, median 3.0, 95th pct 9.0, max 18, share of shuffles with >= actual 0.000 (actual 26)
- Circular shift, flags with Core n >= 50: mean 2.92, median 2.0, 95th pct 8.0, max 17, share of shuffles with >= actual 0.000 (actual 22)

## Null comparison (luck control)

| Data set | Groups tested | Flags (actual) | Label shuffle: mean / 95th pct / max | Circular shift: mean / 95th pct / max |
|---|---|---|---|---|
| (a) V4 trades | 638 | **1** | 1.75 / 6 / 11 | 2.42 / 8 / 23 |
| (a) with Core n ≥ 50 | 638 | **0** | 1.27 / 5 / 10 | 1.61 / 5 / 14 |
| (b) opportunities | 671 | **26** | 0.07 / 1 / 1 | 3.23 / 9 / 18 |
| (b) with Core n ≥ 50 | 671 | **22** | 0.06 / 1 / 1 | 2.92 / 8 / 17 |

- **Set (a)**: 1 flag where luck alone gives 1.75 on average. The one flag (`ownShare > 0.945 & stretchRun ≤ 4`, 56 trades, +20.0 bps) has halves +38.9 / +1.1 and z 2.18 against its own null (p 0.17). **Nothing in V4's own trades beats luck.** With 370 trades, a 3-bin pair holds ~40–60 trades, too few for a 14 bps mean to stand out from noise (V4's per-trade sd on Momentum is 52 bps, so the standard error of a 50-trade mean is about 7 bps).
- **Set (b)**: 26 flags against 3.2 expected under the circular shift; none of 200 shuffles reached 26. As a family, these flags beat luck. Each single group is weaker: circular-shift z runs 1.3–3.3, and the best (3.29) is about what the largest of ~670 null z's would be. So no single group is proven by itself, but there are many more of them than luck makes, and they share a theme.

## Candidates

Choice rule, in this order: the flag holds on the circular-shift null (p ≤ 0.01); the edge is spread over many days (best day < 25% of the edge sum, ≥ 18 days); halves of the same sign on both universes; and the two candidates are different ideas. The crowded-minute groups fail the spread test (3–13 days; `crowded & late` is 3 days with 81% from one), so none are chosen.

| # | Conditions (all at the signal bar) | Mom n | Mom edge | Mom H1 / H2 (n) | Core n | Core edge | Core H1 / H2 | days / symbol-days / episodes | best day share | z circ (p) |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | SPY stretched the **other way** (abs zSPY ≥ 1, opposite sign to the stock's z) **and** 1–2 VWAP crossings in the last 60 bars | 142 | **+28.22** | +44.23 (39) / +22.16 (103) | 74 | +9.79 | +38.92 / +4.70 | 18 / 27 / 61 | 0.20 | 3.29 (0.010) |
| 2 | stock-specific share **> 0.945** over the last 30 bars **and** abs(close − day's first open) **≤ 47 bps** | 549 | **+15.84** | +15.65 (350) / +16.19 (199) | 982 | +1.59 | +0.42 / +2.08 | 29 / 65 / 195 | 0.16 | 2.67 (0.005) |

Plain reading:
1. **Fade a stock that is stretched against the market**, on a day when it has crossed VWAP a little (not a one-way trend, not chop). It's the strongest group, and the whole `spySameSide = no` family backs it: the single bin alone is Mom 607 at +13.4 (halves +27.6 / +4.2), Core 465 at +6.9. Its H2 is weaker than H1, and Core is thin (74 bars on 12 days).
2. **Fade a stock's own move on a quiet day.** The move is almost all the stock's own (SPY explains < 5.5% of it), and the stock is still within ~0.5% of its open. It has the most stable halves of any flag, but its Core edge is near zero (+1.6), so Core agrees only in sign. It's a sharper form of relativeToSpy (C2 uses 0.7) plus a no-trend-day condition.

Caveats for both:
- **The counts are overlapping bars, not tradable trades.** Episodes (runs of consecutive qualifying bars) are 61 and 195 on Momentum. With one position per symbol, a rule would trade about that many times, and its edge per trade could differ from the bar-weighted mean.
- **Before costs.** +15.8 bps barely clears the ~14.2 bps round trip. +28 bps clears it, on about 2 trades a day.
- **Same 32 days, chosen after looking.** These are survey picks from 1,309 tested groups. Each would cost one config and go through the keep rule, and only Stage 3 can confirm it.

## Conclusion

On V4's own trades, no combination of conditions beats luck. Too few trades fall in any group, and the one flag is what chance produces. Searching more widely, over every stretched bar, does turn up real structure: far more groups clear the bar than a clustering-aware shuffle produces (26 vs ~3). It is mostly one idea, **fade stretches that SPY doesn't share, especially when SPY is stretched the other way**. That idea is already behind relativeToSpy (C2), the one Stage 2 step whose trades actually got better. Of the two candidates, (1) "SPY stretched the opposite way + 1–2 VWAP crossings" has the larger edge, and (2) "own share > 0.945 on a quiet day" has the steadier one. Each could be built as one entry rule. Neither is proven on its own: their single-group evidence is about 3 sigma after a search of ~1,300 groups. They weren't built or run.
