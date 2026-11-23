# Relative to SPY (stock-specific moves only)

**Type:** entry filter  ·  **File:** `filters/relativeToSpy.ts`
**Switch:** `useRelativeToSpy`  ·  **Knobs:** `benchmarkSymbol` = SPY (must be in symbols)  ·  **Status:** stub (lets every trade through), owner to fill in
**Owner:** _(name)_

## Origin
First implemented by **Alex Rivera** (PR #78, `aaf0815`): enter only if the stock's 1-minute move in the fade direction is more than 2× |SPY's 1-minute move| (β = 1, about a 0.5 share cutoff over one bar). The Stage 2 session builds the specced filter on top of his code.

## Main idea
When the whole market moves, the move comes back less. Fade only moves the stock made on its own.

## Spec (locked before the batch)
*Confirmed by the lead 2026-11-23. Don't change it after the batch starts.*
- **β (hedge ratio): β = 1** for the filter (the simplest version). A rolling OLS β, from past bars only, is a later variant and needs reserve budget.
- **Residual stretch:** `resid = ret(stock) − β · ret(SPY)` over `lookbackBars`, where `total = ret(stock)` over the same bars.
- **Filter (version 1, run first):** enter only if `|resid| / |total| ≥ cutoff`. There are two cutoffs (the 2 values per knob): **0.5** and **0.7**. This doesn't change what z means, so the other thresholds stay as they are.
- **New signal (version 2):** compute z on the residual instead of the raw move. Run it **only if the filter passes the keep rule**. It needs `entryZ` and the edge gate retuned, which uses R2 budget.
- **SPY and QQQ are excluded** from trading while this switch is on. SPY is the benchmark only. QQQ is excluded because it has no stock-specific component.
- **Window:** `lookbackBars` (30), as specced. Rivera's 1-minute rule (PR #78) is the code it starts from; it's documented under Origin but not run as a separate row.
- **Mechanism check:** the β of per-trade P&L to SPY falls (metric in `runtime/team3Metrics/rspy.ts`), and the reversion share rises above 15.5% Core / 17.6% Momentum.
- **Budget:** 2 configs (cutoffs 0.5 and 0.7). The new-signal version runs after the combining step, from the combining budget. See [MASTER, Parallel Stage 2](../MASTER.md#parallel-stage-2).

## Objective
- Removes / improves: fades of market-wide moves.
- Success looks like: _(metric, direction vs baseline)_

## How it works for us
- Hooks in at: entry filters, last in order.
- Inputs it reads: _(fields)_
- Missing data: _(what it does)_

## Math
_(Short reason, then formula. Define every symbol.)_

## Source
_(Paper / link. Took: ... Changed: ...)_

## Tests
`backend/src/tests/strategy/team3Reversal/relativeToSpy.test.ts`: _(what each case proves)_

## Results (Stage 2)
In-sample, against the frozen V4 baseline (A03 Core / A04 Momentum). Full rows: [ledger-rspy.md](../results/ledger-rspy.md).

| Row | Universe | Net $ (base) | Trades | bps/trade | Rev % | β to SPY (base) | Boot vs baseline | Boot vs exclusion-only ref (RS-V3) | Keep rule |
|---|---|---|---|---|---|---|---|---|---|
| RS-01 (0.5) | Momentum | −1,037.56 (−1,647.82) | 286 | −7.73 | 19.9 | 0.295 (0.453) | +19.07 $/day, share 1.00, halves agree | +2.22, share 0.849, halves **disagree** | PASS |
| RS-01 (0.5) | Core | −1,800.74 (−3,048.74) | 247 | −15.07 | 16.6 | 0.100 (0.259) | +39.00, 1.00, agree | +5.28, 0.995, agree | Core agrees |
| RS-02 (0.7) | Momentum | −912.10 | 258 | −7.55 | 19.8 | 0.105 | +22.99, 0.9999, agree | +6.14, 0.866, **disagree** | PASS |
| RS-02 (0.7) | Core | −1,426.88 | 217 | −13.58 | 19.4 | 0.006 | +50.68, 1.00, agree | +16.96, 1.00, agree | Core agrees |

- The mechanism moves as predicted: reversion share up, β of trade P&L to SPY down sharply (0.453 → 0.105 Momentum at 0.7).
- The filter excludes SPY (and QQQ) from trading, which is R2-01 on its own (RS-V3: Momentum −1,108.59, Core −1,969.73). On Momentum most of the gain vs baseline is that exclusion; the filter's own effect over it is not robust (shares 0.85 / 0.87, halves disagree). On Core it is clear.
- RS-02 is the combining candidate. It already contains R2-01, so the two are not stacked.
- Every row still loses money. Rivera's boundary test (own share exactly 0.5) now expects `true` (the spec says `>=`).

## Ablation rows
RS-V1, RS-V2 (parity), RS-V3 (exclusion-only reference), RS-01, RS-02: [ledger-rspy.md](../results/ledger-rspy.md), merged into [ablation.md](../ablation.md#stage-2-parallel-goal-sessions).
