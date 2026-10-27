# Execution algorithms and sinks

Execution algorithms decide how an approved intent is submitted. Execution
sinks decide where it goes. Both are under `backend/src/core/execution/`.

## Active routing

`ExecutionEngine.submit()` selects an `IExecutionAlgo` using
`intent.executionAlgo`, then calls its `execute(intent, sink)`. The registry
currently contains only `market → DirectExecutionAlgo`. Missing or unregistered
algorithm values fall back to that direct route.

The registry label `market` means direct submission; it does not convert every
intent into a market order. The intent's `orderType`, prices and time-in-force
still reach the sink. Strategies can request market, limit, stop, or stop-limit
orders through `StrategySignal.order`. Default and pricing semantics are in
[backtest decisions and fills](backtest-execution.md#orders-from-a-signal).

## Sinks

| Sink | Purpose |
|---|---|
| `PaperExecutionSink` | Submit/cancel against the configured Alpaca paper adapter |
| `LiveExecutionSink` | Submit/cancel against the Alpaca live adapter in the separately gated real-money runtime |
| `SimulatedExecutionSink` | Local/historical fills using bars or quote/trade execution models |
| `JournaledExecutionSink` | Runtime wrapper that persists an order before forwarding submission |

Execution is asynchronous: submission success does not mean a fill. Order/fill
events drive portfolio state and reservation release. Journaling and broker
reconciliation belong to [broker ledger](broker-ledger.md); reservation handling
belongs to [OMS](oms-layer.md).

## TWAP and VWAP are scaffolds

`algos/twapExecution.ts` and `algos/vwapExecution.ts` define classes and planned
helpers, but their `execute()` methods throw and neither is registered in
`ExecutionEngine`. Setting `executionAlgo: "twap"` or `"vwap"` on an intent
therefore falls back to direct execution today; it does not schedule slices.

`ParentChildOrderTracker` is implemented, but these algorithms do not wire it,
timers/volume subscriptions, cancellation, or per-child capital handling into
the runtime. The original proposed implementation is preserved in the
[historical specification](../history/implementation-plans/architecture-execution-algos-layer.md).

Any future scheduler must define child-order risk/reservations, partial-fill and
cancellation accounting, shutdown/restart behavior, and simulated-clock behavior
before being registered. Wall-clock timers alone do not produce equivalent
historical and live execution.
