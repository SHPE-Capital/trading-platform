# OMS Layer — Implementation Guide

## Overview

The Order Management System (OMS) sits between strategy signal emission and the risk/execution pipeline. Its job is to ensure **capital is committed before risk checks run**, **orders are prioritized fairly**, and **parent-child relationships are tracked** for algorithmic execution strategies like TWAP and VWAP.

```
Strategy Signal
    ↓
Orchestrator._onStrategySignal()   ← position sizer called here (future)
    ↓
ORDER_INTENT_CREATED event
    ↓
Orchestrator._onOrderIntent()
    ↓
[1] CapitalReservationManager.reserve()    ← reserves capital atomically
    ↓ (if sufficient cash)
[2] RiskEngine.check()                     ← existing 8 checks run here
    ↓ (if passed)
[3] OrderIntentQueue.enqueue()             ← priority queue (future dequeue loop)
    ↓
ExecutionEngine.submit()
    ↓
IExecutionAlgo.execute()          ← DirectExecutionAlgo, TwapExecutionAlgo, etc.
    ↓
IExecutionSink.submitOrder()      ← paper/live Alpaca or simulated
```

---

## Classes

### `CapitalReservationManager` — `core/oms/capitalReservation.ts`

Maintains a `Map<reservationId, CapitalReservation>` of committed but not-yet-filled capital. This ensures that when two strategies submit orders in the same event loop tick, the second cannot overdraft the cash that the first already claimed.

**Public API:**

| Method | Signature | Description |
|---|---|---|
| `reserve` | `(intent, totalCash) → { reservationId, amount } \| null` | Atomically claims `intent.qty * intent.limitPrice` from available cash. Returns `null` if amount is zero or exceeds `getAvailableCash(totalCash)`. |
| `release` | `(reservationId) → void` | Frees a reservation on fill, cancel, or rejection. |
| `getReservedTotal` | `() → number` | Sum of all active reservation amounts. |
| `getAvailableCash` | `(totalCash) → number` | `totalCash - getReservedTotal()`. |
| `clear` | `() → void` | Drops all reservations (on engine stop or kill switch). |

**Integration point:** `Orchestrator._onOrderIntent()` — call `reserve()` before `riskEngine.check()`. Store `reservationId` in `intent.meta.reservationId` so it can be released later.

**Release triggers:**
- `ORDER_FILLED` → release with `reason: "filled"`
- `RISK_REJECTED` → release with `reason: "rejected"`
- `ORDER_CANCELED` → release with `reason: "canceled"`

**Key invariant:** `availableCash = portfolioState.cash - capitalReservation.getReservedTotal()`

---

### `OrderIntentQueue` — `core/oms/orderQueue.ts`

A sorted array acting as a priority queue. Higher `priority` values dequeue first; ties are broken FIFO by `enqueuedAt`.

**Public API:**

| Method | Signature | Description |
|---|---|---|
| `enqueue` | `(intent, priority) → void` | Adds intent to the queue and re-sorts. |
| `dequeue` | `() → QueuedOrderIntent \| null` | Removes and returns the top-priority intent. |
| `peek` | `() → QueuedOrderIntent \| null` | Inspects without removing. |
| `size` | `() → number` | Current queue depth. |
| `clear` | `() → void` | Empties the queue (on engine stop). |

**Priority convention (suggested):**

| Intent Type | Priority |
|---|---|
| Close / stop-loss | 100 |
| Reduce position | 75 |
| New entry (high confidence) | 50 |
| New entry (normal) | 25 |
| Counterpart leg (pairs) | 20 |

**Dequeue loop (to implement):** A `setInterval` or event-driven drain in the orchestrator should call `queue.dequeue()` and pass the intent to `executionEngine.submit()`. This replaces the direct submit call in `_onOrderIntent()`.

---

### `ParentChildOrderTracker` — `core/oms/parentChildOrder.ts`

Tracks the relationship between a large "parent" order (the original strategy intent) and the individual "child" slices submitted to the market by TWAP or VWAP algorithms.

**Public API:**

| Method | Signature | Description |
|---|---|---|
| `createParent` | `(intent, algoType, algoParams) → ParentOrder` | Registers a new parent and returns it. |
| `addChild` | `(parentId, childIntent) → ChildOrder` | Registers a slice for a parent. |
| `onChildFill` | `(childOrderId, fill) → void` | **TODO** — accumulates fill qty into child and parent. |
| `getParent` | `(parentId) → ParentOrder \| null` | Lookup by parent ID. |
| `getChild` | `(childId) → ChildOrder \| null` | Lookup by child ID. |
| `isComplete` | `(parentId) → boolean` | **TODO** — true when `filledQty >= totalQty`. |
| `getPendingParents` | `() → ParentOrder[]` | **TODO** — all parents without `completedAt`. |

---

## OMS Event Reference

All events follow the `BaseEvent` shape (`id`, `type`, `ts`, `mode`).

### `CAPITAL_RESERVED`
```typescript
{ reservationId: UUID; amount: number; intentId: UUID; strategyId: string }
```
Published by orchestrator after `CapitalReservationManager.reserve()` succeeds.

### `CAPITAL_RELEASED`
```typescript
{ reservationId: UUID; reason: "filled" | "canceled" | "rejected" }
```
Published by orchestrator when releasing a reservation.

### `CAPITAL_UNAVAILABLE`
```typescript
{ intentId: UUID; strategyId: string; required: number; available: number }
```
Published instead of `RISK_REJECTED` when the intent is blocked by insufficient cash (before risk checks even run).

### `ORDER_QUEUED`
```typescript
{ intentId: UUID; strategyId: string; priority: number; queueDepth: number }
```
Published when an intent is added to `OrderIntentQueue` instead of submitted directly.

### `CHILD_ORDER_CREATED`
```typescript
{ parentIntentId: UUID; childIntentId: UUID; sliceIndex: number; totalSlices: number }
```
Published by `TwapExecutionAlgo` or `VwapExecutionAlgo` when a slice is submitted.

---

## Implementation Checklist

- [ ] **Wire `CapitalReservationManager` into `Orchestrator._onOrderIntent()`** — call `reserve()` before `riskEngine.check()`, publish `CAPITAL_UNAVAILABLE` on failure, publish `CAPITAL_RESERVED` on success.
- [ ] **Release reservations on fill/cancel/reject** — listen to `ORDER_FILLED`, `ORDER_CANCELED`, `RISK_REJECTED` events and call `release(intent.meta.reservationId)`.
- [ ] **Wire `OrderIntentQueue` into `_onOrderIntent()`** — enqueue after risk passes, add dequeue loop.
- [ ] **Implement `ParentChildOrderTracker.onChildFill()`** — accumulate fill qty, mark completion.
- [ ] **Implement `ParentChildOrderTracker.isComplete()`** — check `filledQty >= totalQty`.
- [ ] **Implement `ParentChildOrderTracker.getPendingParents()`** — filter by `completedAt === undefined`.
- [ ] **Pass `CapitalReservationManager` and `ParentChildOrderTracker` to TWAP/VWAP algos** via `ExecutionEngine` constructor.
