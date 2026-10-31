# Backtesting

Run historical experiments through the app or CLI. This guide covers operation;
[backtest decisions and fills](../architecture/backtest-execution.md) owns clock,
execution-model, cache, and fill-fidelity details.

## Prerequisites

Start [the local stack](local-development.md), or the API and worker from the
[no-Docker setup](local-development-no-docker.md). Have an active member login
and either personal Alpaca data credentials or cached bars for the chosen dates.
Starting only the API queues work but does not execute it.

Strategy support comes from the common catalog: registered entries are
backtestable unless `backtestable: false`. It is no longer a pairs-only factory.
Lifecycle/visibility and trading eligibility are separate; see
[strategy policy](../architecture/strategy-policy.md). The historical engine
feeds bars to strategies; quote-priced fills do not provide every historical
quote/trade as a strategy input.

## Run and save through the app

1. Open **Backtests**, select an eligible type or saved strategy/version, and
   choose a date range for which you have data.
2. Set the strategy parameters, capital, costs, and fill model. Non-pairs
   strategy forms come from manifest `params`.
3. Start the backtest. The request either reuses an identical result, joins
   queued/running work, or creates a durable job for a worker.
4. Watch progress and inspect the resulting metrics, trades, and data warnings.
5. **Save** a result you want to retain. Completion does not automatically save
   it to permanent results. Staged artifacts expire after
   `BACKTEST_RESULT_TTL_SECONDS` (default 1,800 seconds).

The run's strategy version identifies algorithm code; the selected saved
configuration version identifies settings. The worker records the build that
actually executed the experiment. An old configuration does not execute an old
copy of algorithm source.

## HTTP workflow

Use the backtest API base (local default `http://localhost:8082/api`). Requests
that run or save require `Authorization: Bearer <your Supabase access token>`
and active membership. The frontend supplies the token automatically.

`POST /backtests/run` accepts a configuration such as:

```json
{
  "name": "SPY reversal experiment",
  "strategyConfig": {
    "type": "beginner_reversal",
    "symbols": ["SPY"],
    "qtyPerTrade": 1,
    "maxPositionQty": 1
  },
  "startDate": "2026-10-12T13:30:00Z",
  "endDate": "2026-10-13T20:00:00Z",
  "initialCapital": 100000,
  "dataGranularity": "bar",
  "slippageBps": 5,
  "commissionPerShare": 0.005
}
```

This request exercises the same beginner reference currently available in the
UI as **Beginner Reversal (course)**. Factory defaults fill
missing strategy settings. Use the dates available in your cache/account.

| Endpoint, relative to API base | Result |
|---|---|
| `POST /backtests/run` | `202` with `backtestId` for queued/joined work; `200` for a reused completed result |
| `GET /backtests/:id/stream` | SSE `status`, `progress`, then `complete` or `error` |
| `GET /backtests/:id` | Saved/staged summary, `202` while in progress, or `404` when unavailable |
| `POST /backtests/:id/save` | Persists staged result, orders and fills; repeated save confirms an existing result |
| `GET /backtests` | Saved result summaries |

`force: true` skips completed-result reuse; an identical in-flight job can still
be joined. Algorithm/engine version and execution/risk settings participate in
result identity. When tagging a saved version, pass both `strategyId` and its
matching `strategyVersionId`; the API verifies their relationship.

Quote fills are selected with `execution: { "model": "quote", "latencyMs": 250 }`.
Configuration fields and result evidence are explained in
[fill models](../architecture/backtest-execution.md#execution-models).

## CLI workflow

Run from `backend/` with that process's Supabase/data configuration available.
The CLI bypasses the queue, executes one experiment, and persists its result.
Set these variables in your shell before `npm run dev:backtest`:

| Variable | Meaning |
|---|---|
| `BACKTEST_STRATEGY_TYPE` | Catalog type; default `pairs_trading` |
| `BACKTEST_STRATEGY_CONFIG` | JSON object of strategy overrides; default `{}` |
| `BACKTEST_FROM`, `BACKTEST_TO` | ISO date range; defaults currently span 2023, so set these deliberately |
| `BACKTEST_CLI_OWNER_ID` | Required `app_users.id` for persistence; find it through authenticated `GET /api/auth/me` |

The CLI uses the same catalog constructor as workers and trading. It currently
sets capital/cost defaults in `runtime/backtest.ts`; use the app/API for the
full experiment configuration rather than assuming every API field has a CLI
environment variable.

## Troubleshooting and limits

- **Queued forever:** check the worker logs, database migrations, and matching
  `APP_RUNTIME_ORIGIN` between API and worker.
- **Missing bars/401:** verify data keys or seed the exact range using
  [local data setup](local-development.md#seeding-cached-bars).
- **No trades:** inspect minimum observations, trigger kinds, session coverage,
  and risk rejections before changing the strategy.
- **Cannot save an old result:** the staging window may have expired; rerun.
- **Partial save failure:** result/order/fill inserts are not one transaction.
  A result row can exist before order/fill persistence finishes; the current
  already-saved shortcut does not repair an incomplete save. Inspect the rows
  after a persistence error rather than assuming retry repairs them.

The worker claims one job per process because simulated time is process-global.
Concurrency is increased with additional workers, subject to per-member caps.
Use [testing](testing.md) for synthetic engine checks and
[strategy troubleshooting](troubleshooting-strategies.md) for decision diagnostics.
