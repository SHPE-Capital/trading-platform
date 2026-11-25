# Stage 4a universe: out-of-universe stocks similar to Momentum

Selected with `selectUniverse.ts` on 2026-06-01 → 2026-08-31 1-minute bars only. No test-period data or strategy results were used.

| | |
|---|---|
| **Pool** | S&P 500 (Wikipedia rev 1370105675, 2026-08-19) + Nasdaq-100 (rev 1368915166, 2026-08-11) |
| **Rank** | Distance to the Momentum centroid (AMD, META, MU, NVDA, TSLA) on z-scored realized vol, log $ volume, beta, correlation to SPY, VWAP-stretch frequency |
| **Select** | ≤ 8 per GICS sector, top 25; dollar-volume floor $500M (**fallback used**) |
| **Benchmark** | SPY, not traded |
| **Symbols** | `AVGO,INTC,ORCL,PLTR,AMAT,GEV,WDC,LRCX,HOOD,STX,CAT,VRT,GS,COIN,RKLB,GE,APP,FCX,ETN,BA,C,FIX,MS,NEM,RDDT,SPY` |

## Momentum reference

| Ticker | Sector | Price $ | $ vol/day (M) | Coverage | Vol (bps/min) | Beta | Corr | Stretch ≥1.5 |
|---|---|---|---|---|---|---|---|---|
| AMD | | 505.02 | 10883 | 100.00% | 16.11 | 3.35 | 0.65 | 16.6% |
| META | | 592.44 | 8261 | 100.00% | 8.88 | 1.07 | 0.38 | 17.3% |
| MU | | 963.36 | 35065 | 100.00% | 19.35 | 3.86 | 0.62 | 17.1% |
| NVDA | | 209.10 | 22116 | 100.00% | 8.73 | 1.87 | 0.67 | 21.5% |
| TSLA | | 369.70 | 13181 | 100.00% | 10.36 | 1.88 | 0.57 | 17.6% |

Range gate: vol 6.55–24.18 bps/min, beta 0.80–4.83.

## Selected

| Rank | Distance | Ticker | Sector | Price $ | $ vol/day (M) | Coverage | Vol (bps/min) | Beta | Corr | Stretch ≥1.5 |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 1.390 | AVGO | Information Technology | 390.95 | 6825 | 100.00% | 10.64 | 2.14 | 0.63 | 18.0% |
| 2 | 1.929 | INTC | Information Technology | 106.56 | 9999 | 100.00% | 17.71 | 3.48 | 0.61 | 19.0% |
| 3 | 2.172 | ORCL | Information Technology | 155.68 | 3900 | 100.00% | 13.22 | 2.22 | 0.52 | 16.6% |
| 4 | 2.278 | PLTR | Information Technology | 143.14 | 4795 | 100.00% | 11.94 | 1.70 | 0.45 | 17.3% |
| 5 | 2.427 | AMAT | Information Technology | 544.31 | 3592 | 100.00% | 15.52 | 3.08 | 0.62 | 19.1% |
| 6 | 2.993 | GEV | Industrials | 1012.74 | 2276 | 99.93% | 12.79 | 1.97 | 0.48 | 16.7% |
| 7 | 3.001 | WDC | Information Technology | 539.92 | 3682 | 100.00% | 19.60 | 3.27 | 0.52 | 16.2% |
| 8 | 3.009 | LRCX | Information Technology | 333.37 | 2588 | 100.00% | 16.09 | 3.30 | 0.64 | 19.4% |
| 9 | 3.014 | HOOD | Financials | 99.34 | 2107 | 100.00% | 16.13 | 2.86 | 0.55 | 18.3% |
| 10 | 3.030 | STX | Information Technology | 886.29 | 3478 | 100.00% | 19.44 | 3.05 | 0.49 | 16.3% |
| 11 | 3.102 | CAT | Industrials | 897.28 | 2030 | 99.97% | 9.72 | 1.70 | 0.55 | 17.8% |
| 12 | 3.648 | VRT | Industrials | 293.06 | 1369 | 100.00% | 15.31 | 2.73 | 0.56 | 16.2% |
| 13 | 3.808 | GS | Financials | 1052.29 | 1493 | 99.80% | 8.07 | 1.29 | 0.50 | 17.4% |
| 14 | 3.958 | COIN | Financials | 161.86 | 1123 | 100.00% | 16.39 | 2.64 | 0.50 | 19.2% |
| 15 | 4.281 | RKLB | Industrials¹ | 85.01 | 1578 | 100.00% | 20.73 | 3.53 | 0.53 | 15.1% |
| 16 | 4.490 | GE | Industrials | 353.89 | 987 | 100.00% | 7.77 | 1.15 | 0.46 | 18.8% |
| 17 | 4.499 | APP | Communication Services | 433.90 | 2176 | 100.00% | 15.20 | 1.78 | 0.37 | 12.7% |
| 18 | 4.559 | FCX | Materials | 66.07 | 739 | 100.00% | 10.94 | 2.06 | 0.59 | 20.6% |
| 19 | 4.624 | ETN | Industrials | 414.38 | 693 | 99.90% | 9.74 | 1.65 | 0.53 | 16.7% |
| 20 | 4.681 | BA | Industrials | 220.16 | 978 | 99.87% | 7.80 | 1.02 | 0.41 | 17.6% |
| 21 | 4.723 | C | Financials | 136.22 | 1055 | 99.99% | 7.00 | 0.93 | 0.42 | 16.4% |
| 22 | 4.767 | FIX | Industrials | 1772.83 | 659 | 99.50% | 15.31 | 2.22 | 0.45 | 16.3% |
| 23 | 4.846 | MS | Financials | 216.23 | 821 | 99.83% | 7.46 | 1.02 | 0.43 | 17.7% |
| 24 | 4.884 | NEM | Materials | 104.49 | 617 | 99.99% | 9.03 | 1.52 | 0.52 | 19.8% |
| 25 | 5.023 | RDDT | Communication Services | 171.52 | 759 | 99.79% | 16.94 | 2.04 | 0.38 | 15.3% |

By sector: Industrials 8, Information Technology 8, Financials 5, Communication Services 2, Materials 2.

¹ Nasdaq-100 only: ICB industry mapped to the nearest GICS sector.

## Next 10 by distance (not selected)

| Distance | Ticker | Sector | Reason |
|---|---|---|---|
| 3.090 | DELL | Information Technology | sector cap |
| 3.140 | QCOM | Information Technology | sector cap |
| 3.268 | MRVL | Information Technology | sector cap |
| 3.354 | LITE | Information Technology | sector cap |
| 3.421 | KLAC | Information Technology | sector cap |
| 3.455 | GLW | Information Technology | sector cap |
| 3.493 | TXN | Information Technology | sector cap |
| 3.589 | CRWV | Information Technology | sector cap |
| 3.639 | MSTR | Information Technology | sector cap |
| 3.654 | CSCO | Information Technology | sector cap |

## Filter log

| Step | Left | Removed |
|---|---|---|
| 0 pool (S&P 500 + Nasdaq-100, 2026-08-31) | 518 | – |
| 1 exclude the 11 used symbols (and their other share classes) | 508 | AAPL, AMD, AMZN, GOOG, GOOGL, META, MSFT, MU, NVDA, TSLA |
| 2 common stock only (no ADR/ETF, one share class) | 500 | ARM, ASML, FOX, KVUE, NWS, PDD, PSKY, WBD |
| 3 average price > $20 | 493 | AES, F, HBAN, NCLH, PCG, TTD, VTRS |
| 4 average daily dollar volume >= $500M | 134 | 359 symbols |
| 5 entry-window bar coverage >= 99% | 125 | AZO, BLK, DE, MCK, NXPI, PWR, SPCX, UNP, VLO |
| 6 realized vol and beta inside the Momentum range (x0.75 .. x1.25) | 62 | 63 symbols |
| select: rank by distance, <= 8 per sector, top 25 | 25 | 26 symbols |

## Flags (reported only)

**Corporate actions in the window** (selected stocks):

- None.

**Near a cutoff:**

- ABNB: excluded on dollar volume ($488M), within 5% of the floor
- CMG: excluded on dollar volume ($484M), within 5% of the floor
- FLEX: excluded on dollar volume ($496M), within 5% of the floor
- MPC: excluded on dollar volume ($494M), within 5% of the floor
- NCLH: excluded on price ($19.19), within 5% of $20
- SLB: excluded on dollar volume ($480M), within 5% of the floor
- MS: selected, distance 4.846 within 5% of the last pick (5.023)
- NEM: selected, distance 4.884 within 5% of the last pick (5.023)
- CDNS: not selected, distance 5.073 within 5% of the last pick (5.023)
- CVNA: not selected, distance 5.188 within 5% of the last pick (5.023)
