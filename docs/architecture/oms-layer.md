# Order management and capital reservations

Order management spans `core/engine/orchestrator.ts`, `core/state/orderState.ts`,
`core/oms/capitalReservation.ts`, and the execution sinks under
`backend/src/`. There is no separate active `OrderManager` drain loop.

## Current submission path

1. The orchestrator converts a strategy signal into one or more order intents.
2. Multi-leg signals receive per-leg risk preflight and combined buy-capital
   preflight before either leg is dispatched.
3. Each intent passes ordinary risk checks and its strategy budget check.
4. Buy orders reserve worst-case notional; sell orders receive a zero-dollar
   reservation so pending-order bookkeeping still tracks them.
5. Execution submits the intent. State updates arrive through order/fill events.
6. Partial fills reduce the outstanding reservation proportionally. Terminal
   fill, rejection, cancellation, expiration, or submission failure releases it.

Preflight prevents a known risk/capital rejection from dispatching only one leg.
It is **not an atomic broker transaction**: a broker can accept one leg and
reject the other, or fill legs at different times.

## Reservation manager

`CapitalReservationManager` tracks receipts by reservation ID and reports total
reserved cash, per-strategy amounts, open-order counts, and available cash. It
also exposes group-reservation helpers, but the orchestrator's actual multi-leg
path performs combined preflight followed by individual reservations.

The book is process-local. It prevents competing intents in that runner from
spending the same cash; it does not coordinate arbitrary independent processes
trading one account. Run leases and account ownership are additional boundaries;
see [system architecture](design.md) and [broker ledger](broker-ledger.md).

## Implemented helpers that are not active routing stages

| Helper | State |
|---|---|
| `OrderIntentQueue` (`core/oms/orderQueue.ts`) | Implements priority/FIFO ordering and removal by intent/group; not instantiated by the orchestrator's submission path |
| `ParentChildOrderTracker` (`core/oms/parentChildOrder.ts`) | Implements parent/child creation, accumulated fills, completion and pending-parent queries; not wired into direct execution |
| `priorityConfig.ts` | Supplies strategy evaluation priority used by the orchestrator |

Parent/child fill accounting is implemented; earlier TODO labels in the docs
were stale. Scheduled TWAP/VWAP execution that would use it remains incomplete.
See [execution algorithms](execution-algos-layer.md).

## Persistence and diagnostics

The runtime's journaled execution sink records intent/run/signal attribution
before a broker request. The broker ledger then reconciles durable broker
history. Those database guarantees and drift reports are documented only in
[broker ledger](broker-ledger.md).

`RISK_REJECTED` identifies a failed guard; `CAPITAL_UNAVAILABLE` identifies a
reservation failure. Neither proves an order reached a broker. Use the run's
signal funnel and logs as described in
[strategy troubleshooting](../guides/troubleshooting-strategies.md).
