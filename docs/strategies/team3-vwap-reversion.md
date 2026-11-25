# Team 3 VWAP Reversion: SPY-Divergence, 150-bar hold (L2) v8

Intraday mean reversion to VWAP on 1-minute bars, entered only when the stock's stretch runs against the market's.

| | |
|---|---|
| **Type** | `team3_reversal` |
| **Version** | VERSION 8, frozen commit `2120a7c` |
| **Status** | `ready`, paper trading |
| **Owner** | Team 3 |

## Strategy

| Section | Specification |
|---|---|
| Hypothesis | A stock stretched from VWAP while SPY is stretched the opposite way tends to revert toward VWAP. |
| Universe | NVDA, AMD, MU, TSLA, META. SPY is the benchmark and is never traded. Regular session only. |
| Entry | 1.5 ≤ \|z\| < 3.5 from session VWAP, SPY z ≥ 1 the opposite way, 1–2 VWAP crossings in the last 60 bars. |
| Exit | Back at VWAP, stop at \|z\| ≥ 3.5, 150-bar maximum hold, flat 5 min before the close. |
| Session | No entries in the first 15 or last 15 minutes. Never held overnight. |
| Sizing and risk | $5,000 per entry, $10,000 cap per symbol, $40,000 gross cap. |
| Costs assumed | ≈ 14.2 bps round trip: 5 bps slippage + 2 bps half spread per side, $0.005/share. |

## Evidence

| Sample | Period | Trades | Net bps/trade | Net $ | Note |
|---|---|---|---|---|---|
| In-sample | 2026-09-01 → 10-15 (32 days) | 29 | +14.3 | +194.75 | Max DD $229 |
| Out-of-sample | 2026-10-16 → 11-20 (26 days) | 7 | +27.5 | +91.88 | 90% CI +5.1 … +47.2 |
| Stage 4a: 25 new stocks | 2026-09-01 → 11-20 (58 days) | 192 | −18.8 | −1,750.04 | 90% CI −31.8 … −6.3 |
| Stage 4b: Momentum, 4 prior quarters | 2025-09-01 → 2026-08-31 | 159 | −6.3 | −479.24 | 90% CI −21.4 … +8.5; positive in 2 of 4 quarters |

Stage 4 verdict (pre-registered): **mixed**. The out-of-sample edge didn't reproduce on new stocks or in earlier periods.

Full method and results: [Team 3 Research Report](https://app.notion.com/p/Final-Report-4223788a8ea0806e9018c24490d4dba9).

## Risk

| | |
|---|---|
| **Known risks** | Few trades; one 6-symbol universe. |
| **Kill criteria** | Pause if net bps/trade < 0 after 20 paper trades, or if paper drawdown exceeds $460 (2× in-sample max DD). |

## Parameters

L2 is the platform defaults plus two overrides:

```json
{ "useSpyDivergence": true, "maxHoldBars": 150 }
```

Divergence knobs at their defaults: `divMinZ` 1.5, `divSpyZ` 1, `divCrossMin` 1, `divCrossMax` 2, `stopZ` 3.5.
