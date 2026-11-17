# Volatility-Targeted Sizing

**Type:** sizing  ·  **File:** `sizing.ts` (used in `team3ReversalStrategy.ts`, step 7)
**Switch:** `useVolSizing`  ·  **Knobs:** `riskPerTradeUsd` = 25 (also uses `maxPositionQty`, `lookbackBars`)  ·  **Added in VERSION:** 2

## Main idea
Decide how many dollars a typical 1-minute move may cost us, then buy fewer shares of jumpy stocks and more of calm ones.

## Objective
- Improves: equal risk per trade across symbols (TSLA vs AAPL). This is risk control, **not** a source of profit.
- Success looks like: Sharpe goes up, max drawdown goes down, P&L std across symbols shrinks. Net P&L may not change.

## How it works for us
- Hooks in at: sizing, after all entry filters pass.
- New entry or adding: shares = `volTargetQty`, trimmed so |position| ≤ `maxPositionQty`.
- A fade against the current position closes **all** of it.
- Missing data: fewer than 5 returns, or zero volatility → 0 shares → no trade.
- **Raise `maxPositionQty`** (protocol: 1000) or it can never size above the default of 1.

## Math
Each bar's return:
$$ r_t = \frac{close_t}{close_{t-1}} - 1 $$
Typical 1-minute move, as a fraction (over the last `lookbackBars` bars):
$$ \sigma = \text{std}(r) $$
In dollars per share:
$$ \text{move per share} = \sigma \times price $$
Shares, rounded down:
$$ qty = \left\lfloor \frac{riskPerTradeUsd}{\sigma \times price} \right\rfloor $$

## Source
Hood & Raughtigan (2024), *Volatility Targeting Is Trendy* (SSRN 4773781). Took: inverse-volatility sizing. Note: they find its alpha comes mostly from trend exposure, which our reversal strategy doesn't have. So we claim risk normalization only. Further reading: Moreira & Muir (2017); Harvey et al. (2018).

## Tests
`volSizing.test.ts`: needs enough history, zero vol → 0, calm > jumpy, matches the formula. `team3ReversalStrategy.test.ts` (vol sizing): enters > 1 share, closes the full position, never passes `maxPositionQty`, rejects a short lookback.

## Ablation rows
(fill in after testing)
