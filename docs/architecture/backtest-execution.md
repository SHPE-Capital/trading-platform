# Backtest decisions and fills

How a backtest decides when a strategy acts and what price its orders get.
Covers strategy triggers, the bar-completion clock, and the two execution
models (bar and quote).

## Decision clock: strategy triggers

A strategy declares which market events call its `evaluate()`:

```ts
readonly triggers: readonly ("bar" | "quote" | "trade")[] = ["bar"];
```

The orchestrator skips other event kinds for that strategy in either runtime.
The historical engine currently supplies bar events for strategy decisions;
quote/trade windows price fills rather than supplying a complete strategy feed.
During live streaming, each event still updates symbol state, so a bar strategy
can read the latest quote. A strategy that
declares no triggers is called on every quote, trade and bar, and must guard
against counting one observation twice itself.

`PairsStrategy` triggers on bars. It takes one observation per minute, from
both legs' completed bars (their closes), and only when both legs printed a bar
that minute. Live, the two bars arrive in separate messages in either order, so
the minute is scored when the second one arrives, and never twice.

## When decisions happen

A bar is stamped with the start of its interval, so the 10:00 bar's close is
only known at 10:01. The backtest processes each batch of same-minute bars at
its **end** (`barEndMs`). Strategies, risk checks and new orders all see that
time. Staleness checks measure from when the reference price became known:
`SymbolState.latestMidTs` holds a quote's time, or a bar's end when a bar close
set the mid. A bar close never overwrites a fresher quote mid.

`BACKTEST_ENGINE_VERSION` records these semantics. It is stamped on every queued
config and result, and it is part of the dedup fingerprint, so results produced
under older semantics are never reused.

## Execution models

| | Bar model (default) | Quote model |
|---|---|---|
| Price | Next bar's open ± `halfSpreadBps` ± `slippageBps` | The real bid/ask prevailing when the order reaches the market |
| Timing | Next bar's open | Decision time + `latencyMs` |
| Data | Minute bars only | Historical SIP quotes and trades, a few seconds per order |
| Limit orders | Synthetic touch check at the next open | Marketable on arrival: fill at the touch. Otherwise IOC/FOK expires and DAY/GTC rests until a trade prints *through* the price |
| Stops | Work until a regular-session bar reaches the stop, then fill at the stop, or at the open if the bar gapped through it | Trigger on the first trade at or through the stop, then execute at the quote prevailing at the trigger |

A stop-limit triggers like a stop and then acts as a limit. The bar model
rejects it if its limit is not marketable at the trigger price, as it does any
limit; the quote model rests it.

Under both models, an order only fills against a bar that ends after the order
was placed. Engine v1 could fill an order for a symbol published later in the
same batch at that symbol's same-minute open, which is before the decision.

### Quote model details (`core/execution/quoteFillModel.ts`)

- **Arrival.** The order reaches the market `latencyMs` after the decision. It
  trades against the last quote at or before arrival, if that quote is no older
  than `quoteLookbackMs`. Otherwise it trades against the first quote within
  `maxQuoteWaitMs` after arrival.
- **Fill size.** A marketable order fills in full at the touch. Displayed size
  and queue position are not modelled; the club's order sizes are small next to
  the displayed size of liquid names. `extraSlippageBps` adds adverse slippage
  but never pushes the price past a limit.
- **Resting limits.** These are checked minute by minute during the regular
  session. Trades are fetched only for minutes whose bar range reached through
  the limit. A resting limit fills at its limit price, up to the size printed
  through it. A print exactly at the limit is not a fill.
- **Stops.** A stop rests from arrival until a trade prints at or through its
  stop price, checked minute by minute like a resting limit. It then becomes a
  market order (a stop-limit, a limit) priced from the quote prevailing at the
  trigger, with no further latency; a stop-limit that is not marketable then
  rests as a limit. A stop the market is already through when it arrives
  executes at once.
- **DAY orders.** A resting DAY order expires at the close of its regular
  session: 16:00 New York time on the day it reached the market, or the next
  weekday's close if it arrived after the close. A bar-model DAY stop expires
  the same way. There is no holiday or
  early-close calendar. GTC orders rest until filled, canceled, or the run ends.
- **Fallback.** If no usable quote is found, or Alpaca refuses the data, the
  order is priced by the bar model at the next open. The fill records
  `fallbackReason`. A stop falls back to the bar model's stop handling, including
  one that triggered on a trade but has no quote to price it. The free plan
  cannot read SIP data from the last 15 minutes, so a backtest ending "now"
  falls back for its final orders.

The engine stays synchronous where events are published. Between timestamp
batches it awaits the quote windows it needs (`planArrivals`, `planResting`),
then publishes each decision at its own time.

## Orders from a signal

A signal sends a market IOC order unless it asks for something else:

```ts
order?: { type: "market" | "limit" | "stop" | "stop_limit"; limitPrice?: number; stopPrice?: number; timeInForce?: TimeInForce };
cancelWorkingOrders?: boolean;
```

A missing time in force is IOC for market orders and DAY otherwise. A signal
whose order lacks a price its type needs is dropped with a warning.
`cancelWorkingOrders` cancels the strategy's open orders on the signal's
symbol, and on `meta.counterpartSymbol` for a pair, before the new order goes
out, so an exit does not leave its protective stop working. The cancel stands
even if risk checks then reject the new order. At a broker a cancel is a
request, and the stop can still fill first. A `flat` signal with it only
cancels.

Risk checks value a stop from the worse of the mid and its stop price, and the
Alpaca adapter sends `stop_price`.

## Configuration and result evidence

The app/API/CLI workflow and comparison requests are documented in
[backtesting](../guides/backtesting.md). This page owns execution semantics.

The quote model resolves omitted settings to 250 ms latency, 5 s quote lookback,
5 s maximum wait, 0 bps extra slippage, and the SIP feed.
`latencyMs + maxQuoteWaitMs` may not exceed 30 seconds. These settings and the
bar fill-model overrides participate in experiment identity.

### What a result reports

- Each fill carries `source` (`quote`, `trade` or `bar`), `arrivalBid`/
  `arrivalAsk`, `decisionMid`, and `fallbackReason` where relevant. These fields
  are kept in staged results and API responses; `backtest_fills` has fixed
  columns, so they are dropped on save.
- `metrics.meta.execution` is persisted. It holds the effective settings, fill
  counts by source, fallbacks by reason, and the notional-weighted
  `avgSpreadCostBps` (fill vs arrival mid) and `avgDelayCostBps` (mid move from
  decision to arrival, against the order).

## Data and cache

`AlpacaHistoricalClient` (`adapters/alpaca/historicalData.ts`) pages Alpaca's
`/quotes` and `/trades` endpoints on an explicit feed. A per-process rate limiter
spaces the requests (`ALPACA_DATA_REQUESTS_PER_MINUTE`, default 190 of the free
plan's 200), using the real clock.

Fetched windows are cached as JSON lines under `MARKET_DATA_DIR` (default
`.local/marketdata`, gitignored):

```
{feed}/{quotes|trades}/{SYMBOL}/{YYYY-MM-DD}/{startMs}-{endMs}.jsonl
```

Files hold Alpaca's raw records and are readable from Python
(`pandas.read_json(path, lines=True)`). Order ticks with `rfc3339ToNanos`;
Alpaca trims trailing fraction digits, so the timestamp strings do not sort.

Fetch cost depends on cache coverage and order behavior. Market orders need
short arrival windows; resting limits/stops can require additional trade
windows. Cached windows avoid repeated provider requests. Historical benchmark
timings are not a latency guarantee for another dataset or environment.

## The sim runtime

A sim runtime streaming live data (`EXECUTION_TARGET=sim` with data keys) fills
orders with the same quote model, applied as quotes and trades arrive
(`core/execution/liveQuoteFills.ts`):

- An order reaches the market `SIM_LATENCY_MS` (default 250) after the decision
  and trades against the live quote prevailing then, or the first quote within
  the wait. A trade through a resting limit fills it, a trade at or through a
  stop triggers it, and DAY orders expire at the close.
- Ticks reach the process a little after their timestamps, so an order is
  priced 250 ms after the moment its price depends on. Fills carry that
  moment's time, not the time they were published.
- Quotes come from the stream's feed. On the IEX stream (the default URL) they
  are IEX's own book, often wider than the national best, so fills come out
  worse than they would at the broker.
- An order with no quote in time falls back to the bar model and fills at the
  open of the bar in progress, which can predate a decision made mid-minute.

Fill counts and costs are logged when the runtime stops.
`SIM_EXECUTION_MODEL=bar` restores next-bar fills. A sim runtime without data
keys receives no market data and refuses new runs.

## Not covered yet

- Strategies triggered by quotes or trades in backtests. That needs every quote
  and trade replayed through the engine, not sparse windows: millions of events
  per liquid symbol-day.
