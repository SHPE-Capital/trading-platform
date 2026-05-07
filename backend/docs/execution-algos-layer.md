# Execution Algos Layer — Implementation Guide

## Overview

The execution algo layer sits between the OMS (which approves and queues intents) and the execution sink (which sends orders to the broker). An `IExecutionAlgo` decides **how** to submit an approved order — immediately, sliced over time, or proportional to market volume.

```
ExecutionEngine.submit(intent)
    ↓
ExecutionEngine._algoRouter(intent.executionAlgo ?? "market")
    ↓ returns IExecutionAlgo
IExecutionAlgo.execute(intent, sink)
    ├─ DirectExecutionAlgo  → sink.submitOrder(intent)  immediately
    ├─ TwapExecutionAlgo    → N child orders over [startTime, endTime]
    └─ VwapExecutionAlgo    → dynamic child orders keyed to market volume
```

---

## `IExecutionAlgo` Interface — `core/execution/algos/IExecutionAlgo.ts`

```typescript
interface IExecutionAlgo {
  readonly type: ExecutionAlgoType;
  execute(intent: OrderIntent, sink: IExecutionSink): Promise<Order>;
  cancel(intentId: UUID): Promise<void>;
}
```

**Contract rules:**
- `execute()` returns `Promise<Order>` — for multi-slice algos this is the first child's order or a synthetic parent stub.
- `cancel()` must clean up all pending timers and event subscriptions for the given intent. No-op if nothing is pending.
- Algos are **stateless across intents** — each `execute()` call is independent. Internal state (timer handles, volume accumulators) is keyed by `intentId`.

---

## Registering a New Algo

In `ExecutionEngine` constructor (`core/execution/executionEngine.ts`):

```typescript
this._algos = new Map([
  ["market", new DirectExecutionAlgo()],
  ["twap",   new TwapExecutionAlgo(parentChildTracker, capitalReservation)],
  ["vwap",   new VwapExecutionAlgo(parentChildTracker, capitalReservation, eventBus)],
]);
```

Algos are selected per-intent via `intent.executionAlgo`. Unregistered types fall back to `"market"` via `_algoRouter()`.

---

## `DirectExecutionAlgo` — `core/execution/algos/directExecution.ts`

**Status: Fully implemented.**

Wraps `sink.submitOrder(intent)` directly. This is the refactored behavior from `ExecutionEngine.submit()` prior to the algo routing layer. All current strategies use this path.

---

## TWAP Implementation Guide — `core/execution/algos/twapExecution.ts`

### How TWAP Works

TWAP divides `totalQty` into `numSlices` equal child orders spaced evenly across `[startTime, endTime]`. Each child is submitted via `setTimeout`.

### `_computeSlices(params: TwapParams): ChildSlice[]`

```typescript
const interval = (params.endTime - params.startTime) / params.numSlices;
const qtyPerSlice = Math.floor(params.totalQty / params.numSlices);
const remainder = params.totalQty % params.numSlices;

return Array.from({ length: params.numSlices }, (_, i) => ({
  sliceIndex: i,
  qty: qtyPerSlice + (i === params.numSlices - 1 ? remainder : 0),
  scheduledAt: params.startTime + i * interval,
}));
```

### `_scheduleSlice(slice, sink, parentIntent)`

```typescript
const delay = Math.max(0, slice.scheduledAt - nowMs());
const handle = setTimeout(async () => {
  const childIntent: OrderIntent = {
    ...parentIntent,
    id: newId(),
    qty: slice.qty,
    orderType: params.sliceOrderType,
    // Set limitPrice with tolerance if sliceOrderType === "limit"
  };
  // 1. Reserve capital for this slice
  const reservation = capitalReservation.reserve(childIntent, portfolio.getCash());
  if (!reservation) { /* log and skip slice */ return; }
  // 2. Submit child order
  const order = await sink.submitOrder(childIntent);
  // 3. Register with parent tracker
  parentChildTracker.addChild(parentId, childIntent);
  // 4. Publish CHILD_ORDER_CREATED event
}, delay);

// Store handle keyed by intentId for cancellation
this._pendingTimers.get(intentId)?.push(handle);
```

### `execute()` — Top-level flow

```typescript
async execute(intent: OrderIntent, sink: IExecutionSink): Promise<Order> {
  const params = intent.executionAlgoParams as TwapParams;
  const parent = parentChildTracker.createParent(intent, "twap", params);
  const slices = this._computeSlices(params);

  this._pendingTimers.set(intent.id, []);
  for (const slice of slices) {
    this._scheduleSlice(slice, sink, intent);
  }

  // Return a stub Order for the parent — the real fills arrive via CHILD fills
  return { id: parent.parentId, intentId: intent.id, status: "pending", ... };
}
```

### Passing `TwapParams` from a strategy

```typescript
// In strategy config:
executionAlgo: "twap",
// In signal metadata or directly on the intent:
executionAlgoParams: {
  totalQty: qty,
  startTime: nowMs(),
  endTime: nowMs() + 30 * 60_000,  // 30-minute window
  numSlices: 10,
  sliceOrderType: "market",
  limitPriceTolerancePct: 0.001,
} satisfies TwapParams,
```

---

## VWAP Implementation Guide — `core/execution/algos/vwapExecution.ts`

### How VWAP Works

VWAP subscribes to `TRADE_RECEIVED` events for the target symbol and accumulates market volume. When accumulated volume × `participationRate` ≥ a minimum slice size, a child order is submitted.

### `_computeParticipationQty(marketVolume, participationRate): number`

```typescript
const rawQty = Math.floor(marketVolume * participationRate);
const remainingQty = parent.totalQty - parent.filledQty;
return Math.min(rawQty, remainingQty);
```

### `_onVolumeUpdate(symbol, volume)`

```typescript
this._volumeAccumulators.set(intentId, (this._volumeAccumulators.get(intentId) ?? 0) + volume);
const accumulated = this._volumeAccumulators.get(intentId)!;
const candidateQty = this._computeParticipationQty(accumulated, params.participationRate);

if (candidateQty > 0) {
  const childIntent: OrderIntent = { ...parentIntent, id: newId(), qty: candidateQty };
  const reservation = capitalReservation.reserve(childIntent, portfolio.getCash());
  if (reservation) {
    await sink.submitOrder(childIntent);
    parentChildTracker.addChild(parentId, childIntent);
    this._volumeAccumulators.set(intentId, 0);  // reset bucket
  }
}
```

### EventBus Subscription

```typescript
// In execute():
const handler = (e: TradeReceivedEvent) => {
  if (e.payload.symbol === intent.symbol) {
    this._onVolumeUpdate(intent.symbol, e.payload.size);
  }
};
const subId = eventBus.on("TRADE_RECEIVED", handler);
this._subscriptions.set(intent.id, subId);
```

### Slippage Guard

Check `params.maxSlippage` on each fill. If the fill price deviates from the VWAP baseline by more than `maxSlippage` fraction, call `this.cancel(intent.id)` to stop participation.

---

## Algo Selection Strategy

| Trade size | Urgency | Recommended algo |
|---|---|---|
| Small (< $5k notional) | Any | `"market"` |
| Medium ($5k–$50k) | Low urgency | `"twap"` with 10–20 slices |
| Medium ($5k–$50k) | Follow volume | `"vwap"` with 5–10% participation |
| Large (> $50k) | Risk-sensitive | `"twap"` or `"vwap"` + reduce position size first |

Set `executionAlgo` on the strategy config (via `BaseStrategyConfig.executionAlgo` or `PairsStrategyConfig.executionAlgo`). The orchestrator copies it onto the `OrderIntent` during signal → intent conversion.
