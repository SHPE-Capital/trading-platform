# System architecture

This describes the implementation in the current checkout. Operating procedures
live in [guides](../guides/README.md); this page explains process boundaries and
connects the detailed architecture references. The original design proposal is
preserved in [history](../history/implementation-plans/architecture-design.md).

## Processes and responsibilities

The backend is Node.js/TypeScript with Express; the frontend is a Next.js App
Router application. Supabase supplies Postgres and authentication. Alpaca supplies
market data and optional paper/live broker execution.

| Process | Entry point relative to `backend/src/runtime/` | Responsibility |
|---|---|---|
| API | `../index.ts` | HTTP control plane, historical-data access, queued backtest requests and reports |
| Paper runner | `paper-trading.ts` via `bootstrap.ts` | Strategy lifecycle, market feed, risk and execution against a simulator or Alpaca paper account |
| Backtest worker | `backtestWorker.ts` | Claims durable jobs and runs historical simulations, one job at a time per process |
| Real-money runner | `real-trading.ts` via `bootstrap.ts` | Separate, explicitly gated Alpaca live runtime; absent from the default Docker stacks |
| Recorded-event replay | `replay.ts` | Standalone playback engine and partial HTTP integration; not a complete recorded-session workflow |
| Backtest CLI | `backtest.ts` | Runs and persists a simulation without starting an HTTP server |

Default local ports and startup commands belong to
[local development](../guides/local-development.md). Production topology and
rollout procedures belong to [deployment](../guides/deployment.md).

## Trading event flow

```text
Alpaca feed OR cached-bar feed
              ↓
         EventBus
              ↓
  Orchestrator updates symbol state
              ↓
  eligible strategies evaluate(context)
              ↓
  STRATEGY_SIGNAL_CREATED → order intents
              ↓
  risk checks → strategy budget → capital reservation
              ↓
  ExecutionEngine → execution sink
              ↓
  order/fill events → order state, portfolio state, reservation release
```

`core/engine/eventBus.ts` dispatches subscribers synchronously in order. That
does not make broker requests or persistence synchronous. Submission can finish
later, and a submitted order is not a fill.

The orchestrator updates market state before evaluating strategies. Strategies
declare `triggers` (`bar`, `quote`, `trade`) and read `EvaluationContext`; they
return a `StrategySignal` or `null`. They do not own external API connections or
database writes. Evaluation order uses strategy priority and registration order.
Repeated evaluation errors can disable an individual run in trading runtimes.

## State, persistence, and recovery

Symbol windows, current prices, orders, positions, and strategy-local state are
held in memory for evaluation. `RollingTimeWindow` provides time-based eviction;
it is not a database query on each market event.

Postgres stores configurations, immutable configuration versions, runs, leases,
backtest jobs/results, orders, fills, and diagnostics. In broker trading, the
execution sink journals an order before submitting it: failure to persist the
journal blocks submission. Thus the decision loop uses in-memory state, but the
order submission path deliberately depends on durable storage.

`LiveRunCoordinator` claims and heartbeats runs, adopts eligible orphaned runs,
and fences a runner when it can no longer safely hold its leases. Restoration
uses saved configuration and the current algorithm implementation, persisted
fills, and optional strategy warm-up hooks. It does not serialize arbitrary
strategy-local objects. Retiring a type gates new launches, not restoration.
A runner adopts only runs on its own broker account. A sim account is
`sim:<hostname>`, so the compose files pin the paper-trading container's
hostname; otherwise each recreate would strand the previous book's runs. Expired
sandbox runs no runner holds a lease on are stopped whatever their account.

Account truth and per-run attribution are described in [broker ledger](broker-ledger.md).

## Execution modes and clocks

| Mode | Input | Execution and timing |
|---|---|---|
| Streaming sim | Live market events | Local quote/trade fill simulation, or configured bar fills |
| Cached-bar sim | Bars from Supabase cache | Replay-paced input and bar fills in the paper runner |
| Alpaca paper/live | Live market events | Broker submission and asynchronous broker updates |
| Backtest | Historical bars; optional sparse quote/trade windows for fills | Simulated clock, isolated worker, simulated execution |
| Recorded-event replay | An explicitly loaded in-memory event array | Playback controls exist; persisted-session loading remains incomplete |

Backtests reuse the orchestrator, strategy implementations, risk checks, and
portfolio accounting. They install a process-global clock override, so workers
run one job at a time; scale using more processes. Live bootstrap locks out clock
replacement. Backtests currently evaluate strategies on historical **bar events**;
quote-based fill pricing does not imply a complete historical quote/trade feed
for strategy evaluation. See [backtest decisions and fills](backtest-execution.md).

The three distinct replay paths are explained in [replay](../guides/replay.md).

## Strategy registration and policy

The catalog derives constructors and metadata used by trading, workers, CLI,
and frontend forms. Capability (`backtestable`), visibility (`hidden`), lifecycle
status, and runtime policy are independent concerns. Their rules live in
[strategy policy](strategy-policy.md); implementation steps live in
[adding a strategy](../guides/adding-a-strategy.md).

An algorithm version identifies current code behavior. A configuration version
records settings and the algorithm version at save time. It does not retain an
executable copy of older code. Build SHA and runtime origin identify the deployed
environment; runtime origin also isolates run adoption and queued work.

## Repository boundaries

| Path | Owns |
|---|---|
| `backend/src/app/` | HTTP routes/controllers, authentication, WebSocket delivery |
| `backend/src/adapters/` | Alpaca, Supabase, cached-bar feed integrations |
| `backend/src/core/` | Engine, state, risk, execution, ledger, workers, telemetry |
| `backend/src/strategies/` | Strategy decisions and strategy-specific configuration |
| `backend/src/services/` | Indicators and calculation helpers |
| `backend/src/runtime/` | Process composition and entry points |
| `frontend/app/` | Next.js routes and layouts; no separate `pages/` architecture |
| `frontend/features/`, `hooks/`, `services/` | UI workflows, client state/data access |
| `supabase/migrations/` | Authoritative ordered schema migrations |
| `docker/`, `deploy/`, `scripts/` | Local stacks, production topology, project tooling |

## Detailed references and implementation limits

- [Risk](risk-layer.md): pre-trade checks, budgets, proactive portfolio checks.
- [OMS](oms-layer.md): reservations, order lifecycle, multi-leg submission limits.
- [Sizing](position-sizing-layer.md): current strategy quantities and optional sizer scaffolds.
- [Execution algorithms](execution-algos-layer.md): direct routing; TWAP/VWAP remain unregistered scaffolds.
- [Backtest execution](backtest-execution.md): decision clock, fills, costs, data caches and limitations.
- [Broker ledger](broker-ledger.md): journaling, synchronization, drift and performance attribution.

This is an educational research/execution platform using broker APIs. An
event-driven design and latency instrumentation do not establish exchange-level
HFT performance. Measurements and caveats belong to the
[benchmark runbook](../guides/latency-benchmark.md).
