# Platform issues Team 3 works around (for a later PR)

Team 3 handles all of these inside its own folder today (see
[`CONTRACT.md`](../../backend/src/strategies/team3Reversal/CONTRACT.md)). Each one
affects every strategy, so each is worth a platform PR once the paper is done.

| # | Issue | Where | Effect | Team 3 workaround |
|---|---|---|---|---|
| 1 | The "intraday" drawdown kill switch is measured from the run's starting equity; `resetSession()` is never called. | `core/risk/riskEngine.ts` | On $100k it trips at −$5,000, closes everything and skips all evaluation for the rest of the run. | `protocol.ts`: `maxIntradayDrawdownPct: 1` (off) |
| 2 | `strategy.config.maxPositionSizeUsd` is ignored; the risk engine uses global env caps (`MAX_POSITION_SIZE_USD`, $50k gross). | `riskEngine.ts`, `config/defaults.ts` | Results depend on the `.env`; orders are rejected silently. | `risk.ts` enforces our caps; `protocol.ts` fixes the engine caps above them |
| 3 | Sells reserve $0 of cash, and short proceeds raise spendable cash. | `capitalReservation.ts`, `riskEngine._checkCashReserve` | Capital never limits shorts. | `risk.ts` counts shorts at full notional |
| 4 | No fill callback for strategies. | `strategies/base/strategy.ts` | Strategies guess entry prices. | `book.ts` reads own orders from `orderState` |
| 5 | `getPosition()` is account-wide; `Position.strategyId` is always undefined. | `portfolioState.ts` | Strategies sharing a symbol mix positions. | `book.ts` keeps Team 3's own book |
| 6 | The orchestrator gives each intent a fresh `signalId`, not the strategy's `signal.id`. | `orchestrator.ts:396` | A strategy can't find the order for its signal by id. | `book.ts` matches by strategy, symbol and submit time |
| 7 | Extended-hours bars are replayed and fill market orders; there is no session filter in the loader or risk engine (backtest). | `backtestLoader.ts`, `riskEngine.ts` | A 15:59 signal can fill after hours. | `history.ts` + flatten 5 minutes before the close |
| 8 | `pruneClosedOrders` is never called, so `orderState` grows for the whole run. | `orderState.ts` | Memory; O(n) scans. | `book.ts` scans only while an order is pending |
| 9 | The old Team 3 test harness filled signals instantly at the bar's close. | (was in our tests) | Tests passed on a fill model the engine doesn't use. | Tests now run the real engine (`tests/.../engine.ts`) |
