# Team 3 ↔ Platform Contract

What Team 3 Reversal assumes about the platform, and what it promises back.
Every row is enforced by a test in
[`tests/strategy/team3Reversal/contract.test.ts`](../../tests/strategy/team3Reversal/contract.test.ts)
that runs the **real** `BacktestEngine` under `TEAM3_PROTOCOL`. If the platform
changes, a row's test fails; the result is never a mystery P&L.

**Rule:** only files in `contract/` import platform code (`core/`, `types/`,
`strategies/base/`). Everything else in this folder is pure Team 3 logic. If the
platform changes, only `contract/` and this file change. (Type-only imports of
`BaseStrategyConfig`, `StrategySignal` and `MarketEventKind` in the config and
strategy class are the only exceptions; they are the plug shape itself.)

## Layout

| File | Side | Job |
|---|---|---|
| `contract/frame.ts` | read | `EvaluationContext` → `MinuteFrame`: this bar plus every symbol's latest bar |
| `contract/book.ts` | read | Team 3's own positions and real entry fills, from its own orders |
| `contract/emit.ts` | write | Decision → `StrategySignal` (direction, whole qty, meta) |
| `contract/protocol.ts` | engine | costs, capital and risk config every research run uses |
| `history.ts`, `rules.ts`, `risk.ts`, `sizing.ts`, `vwap.ts`, `session.ts`, `filters/` | pure | the strategy |

## Platform gives us

| # | Assumption | How we use it | Test |
|---|---|---|---|
| G1 | `evaluate()` is called once per (1-min bar, symbol). A signal on bar *k* fills at bar *k+1*'s **open**, ± half spread 2 bps + slippage 5 bps, stamped at *k+1*'s start. | All decisions use closed bars, with no lookahead. Exits and entries arrive one bar after the decision. | G1 |
| G2 | Before any `evaluate()` at a timestamp, `symbolState` holds **every** symbol's bar for it. Symbols are evaluated alphabetically. | `frame.ts` reads other symbols from `symbolState`, so `barsOf("SPY")` is this minute's bar even when evaluating AAPL. | G2 |
| G3 | Engine risk settings come from `BacktestConfig.riskConfig`, merged over the platform default. | `protocol.ts` sets them explicitly: kill switch off, engine caps above ours. | G3 |
| G4 | Pre-market and after-hours bars **are** replayed and can fill orders. | `history.ts` drops them; no decision happens outside 9:30–15:59 ET. | P1 |
| G5 | `portfolioState.getPosition()` is the whole **account's** position. There is no fill callback. Orders carry `strategyId`, `filledQty` and `avgFillPrice`. | `book.ts` builds Team 3's position from its own orders and ignores the account position. | P5, P6 |
| G6 | Sells reserve $0 of cash, and short selling is allowed. | `risk.ts` counts shorts' full notional against Team 3's caps. | P4 |

## We promise back

| # | Promise | Where | Test |
|---|---|---|---|
| P1 | Only today's regular-session bars feed history, VWAP, sigma and "previous bar". | `history.ts` | P1 |
| P2 | The 9:30 bar is never compared to an overnight or pre-market close. | `history.ts` (new day = empty history) | P2 |
| P3 | Flat before 16:00 every day. A position from an earlier day is closed on sight (`stale`). | `rules.ts` `exitReason` | P3 |
| P4 | \|shares\| × price ≤ `maxPositionSizeUsd` per symbol, and Σ ≤ `maxGrossUsd`, shorts included and pending orders counted. | `risk.ts`, `book.exposures()` | P4 |
| P5 | Positions, exit sizes and entry prices are Team 3's own, never the account's. | `book.ts` | P5 |
| P6 | Exit meta `entryPrice` is the real average fill price. | `book.ts` | P6 |
| P7 | Under the protocol, every order is accepted. Anything else is recorded in `book.violations`. | `book.reconcile()` | P7 |
| P8 | Every signal is `long`/`short`/`close_long`/`close_short` with whole `qty > 0`. | `emit.ts` (throws otherwise) | P8 |
| P9 | A config switching on a filter still marked `stub` is refused when saved. | `team3ReversalConfig.ts`, `filters/index.ts` | P9 |
| P10 | `VERSION` changes whenever trading logic changes, so results link to code. | `team3ReversalStrategy.ts` | P10 |
| P11 | Signal `meta` carries the numbers behind each decision: z, VWAP, sigma, edge bps, crossings, filters on, exit reason, P&L bps. | `team3ReversalStrategy.ts` | — |

## Owned by the platform, not our config

Costs, capital, the fill model and the engine's risk config live in
`contract/protocol.ts`. They are written once there and never copied into the
strategy config, so demo numbers and backtest numbers can't drift apart.
Known platform issues we work around (for a later PR):
[`docs/team3/UPSTREAM.md`](../../../../docs/team3/UPSTREAM.md).
