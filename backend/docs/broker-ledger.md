# Broker Ledger

## Overview

The club trades one shared Alpaca account with many strategies. Alpaca knows
what executed, but it nets positions per symbol and cannot say which strategy
an order belonged to. The ledger splits the job:

| Question | Source of truth |
|---|---|
| What executed: orders, fills, fees, cash, positions, account equity | The broker (Alpaca, or the local sim book) |
| Why: which run and version sent each order, from which signal, at what decision price | This database |

Fills are copied from the broker into the database by a sync job, keyed on the
broker's own ids. All strategy analytics read the copy; the account views read
the broker.

## Order path

```
Strategy signal (signalId, runKey)
    ↓
Orchestrator._onStrategySignal()   ← every intent tagged with runId + signalId
    ↓
Orchestrator._onOrderIntent()      ← decisionPrice = mid when decided; risk checks
    ↓
JournaledExecutionSink             ← orders row written as "pending" FIRST
    ↓                                (fails closed: no row, no order)
Alpaca POST /v2/orders             ← client_order_id = <runId>:<intentId>
    ↓
ORDER_SUBMITTED                    ← broker_order_id, status "submitted"
    ↓
trade_updates stream               ← in-memory book + order status (fast path)
    ↓
LedgerMaintainer (every 60 s, and ~3 s after a fill)
    ├─ BrokerSyncService           ← orders, FILL and FEE activities → ledger (durable path)
    └─ checkDrift                  ← broker positions vs the runs' books → broker_drift
```

A sim book (`EXECUTION_TARGET=sim`) is its own broker: `SimulatedExecutionSink`
fills orders on the next bar and the runtime writes those fills directly, so it
has no sync step. `SimBroker` reads the same tables back through `IBroker`.

## Tables (migrations 0015, 0016)

- `broker_accounts` — accounts a runtime origin has claimed. The startup check
  registers a member's own account on first boot.
- `orders.run_id`, `client_order_id`, `signal_id`, `decision_price`, `broker_account`, `source`.
- `fills.run_id`, `broker_fill_id` (unique per account), `broker_account`, `source`.
- `broker_fees` — account-level charges (Alpaca does not tie them to orders).
- `signals` — every signal and its outcome (written from phase 3 on).
- `broker_sync_state` — sync cursors and the last error.
- `broker_drift` — per symbol, only where something is wrong:
  `unattributed_qty` (no run accounts for it) or `stopped_qty` (a stopped run
  left it in the book).
- `ledger_run_positions` (view) — net position per run and symbol from fills.

## Drift

Drift is an alert, never a block. After each pass the runtime publishes
`BROKER_DRIFT` over `/ws/events` whenever the rows change. Two cases:

- **Unattributed** — the broker holds shares no run's fills explain: an order
  placed outside the platform, or history the ledger has not synced.
- **Held by stopped runs** — a run was stopped without flattening; nothing
  manages the position any more.

## Backfill

`npm run broker:backfill` copies an account's whole history into the ledger and
attributes orders that predate run-tagged client ids, using the rules in
`core/ledger/backfillPlan.ts`. It only reads from Alpaca.

```bash
npm run broker:backfill -- --dry-run          # print the plan; writes nothing
npm run broker:backfill                       # local database
npm run broker:backfill -- --confirm-hosted   # required for any non-local SUPABASE_URL
```

It prints whether the ledger's fills reproduce every Alpaca position — the
check that the copy is complete — and the drift that results. Re-running it is
a no-op.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `EXECUTION_TARGET` | `sim` | `sim`, `alpaca-paper`, or `alpaca-live` |
| `EXPECTED_BROKER_ACCOUNT` | — | Account number the keys must resolve to; mandatory on `aws-prod` |
| `BROKER_SYNC_INTERVAL_MS` | `60000` | Ledger sync + drift interval |
