# Live Trading & Paper Trading — Implementation Guide

The Orchestrator (`backend/src/core/engine/orchestrator.ts`), Alpaca adapters, risk
engine, and all state managers are fully implemented. The `runtime/live.ts` entry point
already boots the full stack in paper mode. What remains is:

- Creating the Supabase tables for persistent order/fill/snapshot/run history
- Injecting the app context so controllers can read live state
- Adding persistence hooks so the Orchestrator writes to the DB on each event
- Implementing the strategies controller start/stop actions
- Building the live trading entry point with a feature gate

Complete the steps below in order.

---

## Part 1 — Prerequisites

### 1a. Environment variables

Copy `.env.example` to `.env` and fill in every value. The following are required to
start in paper mode:

```
ALPACA_API_KEY=<your key>
ALPACA_API_SECRET=<your secret>
SUPABASE_URL=<project url>
SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>
```

The following control execution mode and risk limits. Defaults are safe for paper:

```
ALPACA_TRADING_MODE=paper
ENABLE_LIVE_TRADING=false
MAX_POSITION_SIZE_USD=10000
MAX_NOTIONAL_EXPOSURE_USD=50000
ORDER_COOLDOWN_MS=5000
```

### 1b. Install dependencies

```bash
cd backend
npm install
```

### 1c. Alpaca account

Log in to [alpaca.markets](https://alpaca.markets) and confirm:

- Paper trading is enabled (Dashboard → Paper Trading)
- Your API key has read + trade permissions
- The paper account has a non-zero buying power (default $100,000)

---

## Part 2 — Create the Supabase Tables

Open the Supabase dashboard → SQL Editor → New query. Run each block separately and
confirm each table appears in Table Editor before moving to the next.

### Strategy runs

```sql
create table if not exists strategy_runs (
  id              uuid         primary key,
  "strategyId"    uuid,
  type            text         not null,
  name            text         not null,
  status          text         not null default 'idle',
  "startedAt"     bigint       not null,
  "stoppedAt"     bigint,
  config          jsonb,
  "signalCount"   integer      not null default 0,
  "orderCount"    integer      not null default 0,
  "realizedPnl"   numeric      not null default 0
);

create index if not exists strategy_runs_started_at_idx
  on strategy_runs ("startedAt" desc);
```

### Orders

```sql
create table if not exists orders (
  id               uuid         primary key,
  "strategyId"     uuid,
  "brokerOrderId"  text,
  symbol           text         not null,
  side             text         not null,
  qty              numeric      not null,
  "filledQty"      numeric      not null default 0,
  "avgFillPrice"   numeric,
  "orderType"      text         not null,
  "limitPrice"     numeric,
  "stopPrice"      numeric,
  "timeInForce"    text,
  status           text         not null,
  is_paper         boolean      not null default true,
  "submittedAt"    bigint       not null,
  "updatedAt"      bigint,
  "closedAt"       bigint
);

create index if not exists orders_strategy_id_idx on orders ("strategyId");
create index if not exists orders_submitted_at_idx on orders ("submittedAt" desc);
```

### Fills

```sql
create table if not exists fills (
  id          uuid     primary key,
  "orderId"   uuid,
  symbol      text     not null,
  side        text     not null,
  qty         numeric  not null,
  price       numeric  not null,
  notional    numeric  not null,
  commission  numeric  not null default 0,
  is_paper    boolean  not null default true,
  ts          bigint   not null,
  "isoTs"     text,
  exchange    text
);

create index if not exists fills_order_id_idx on fills ("orderId");
create index if not exists fills_ts_idx on fills (ts desc);
```

### Portfolio snapshots

```sql
create table if not exists portfolio_snapshots (
  id                  uuid     primary key,
  ts                  bigint   not null,
  "isoTs"             text     not null,
  cash                numeric  not null,
  "positionsValue"    numeric  not null,
  equity              numeric  not null,
  "initialCapital"    numeric  not null,
  "totalUnrealizedPnl" numeric not null,
  "totalRealizedPnl"  numeric  not null,
  "totalPnl"          numeric  not null,
  "returnPct"         numeric  not null,
  positions           jsonb    not null default '[]',
  "positionCount"     integer  not null default 0
);

create index if not exists portfolio_snapshots_ts_idx
  on portfolio_snapshots (ts desc);
```

---

## Part 3 — Wire AppContext into the Express App

Controllers read live state from `req.app.locals.ctx`. Right now `createApp()` does not
accept a context, so every controller that touches the orchestrator or state managers
will fail.

### Step 1 — Update `createApp()` to accept a context

**File:** `backend/src/app/index.ts`

Add an import for `AppContext` and update the function signature:

```typescript
import type { AppContext } from "./context";

export function createApp(ctx?: AppContext): express.Application {
  const app = express();

  // Store context on app.locals so all controllers can access it
  if (ctx) {
    app.locals.ctx = ctx;
  }

  // ... rest of existing middleware and route setup unchanged ...
}
```

### Step 2 — Build and pass the context from `runtime/live.ts`

**File:** `backend/src/runtime/live.ts`

After all infrastructure is instantiated but before `createApp()` is called, build the
context object and pass it in:

```typescript
import type { AppContext } from "../app/context";

// After orchestrator, symbolState, portfolioState, orderState, riskEngine are created:
const ctx: AppContext = {
  orchestrator,
  symbolState,
  portfolioState,
  orderState,
  riskEngine,
};

const app = createApp(ctx);
```

### Step 3 — Add a context accessor helper

**File:** `backend/src/app/context.ts`

Add a helper used by every controller that needs the context:

```typescript
import type { Request } from "express";

export function getCtx(req: Request): AppContext {
  const ctx = req.app.locals.ctx as AppContext | undefined;
  if (!ctx) throw new Error("AppContext not available — wrong runtime mode");
  return ctx;
}
```

---

## Part 4 — Add Persistence Hooks to the Orchestrator

The Orchestrator does not currently write to Supabase during a live session. Subscribe
to the relevant events in `runtime/live.ts` after the orchestrator is created and before
`orchestrator.start()` is called.

**File:** `backend/src/runtime/live.ts`

```typescript
import {
  insertOrder,
  insertFill,
  updateOrder,
  insertStrategyRun,
  updateStrategyRun,
} from "../adapters/supabase/repositories";

const IS_PAPER = env.alpacaTradingMode !== "live";

// Persist every submitted order
eventBus.on("ORDER_SUBMITTED", async (event) => {
  await insertOrder(event.order, IS_PAPER);
});

// Persist every fill and update the parent order row
eventBus.on("ORDER_FILLED", async (event) => {
  await insertFill(event.fill, IS_PAPER);
  await updateOrder(event.orderId, {
    status: event.status,
    filledQty: event.filledQty,
    avgFillPrice: event.avgFillPrice,
    closedAt: event.fill.ts,
  });
});

// Update order row on cancel/reject (no fill to persist)
eventBus.on("ORDER_CANCELED", async (event) => {
  await updateOrder(event.orderId, { status: "canceled", closedAt: Date.now() });
});
```

---

## Part 5 — Add a Portfolio Snapshot Scheduler

Portfolio state is in-memory. Without periodic persistence the equity curve and position
history are lost on restart.

**File:** `backend/src/runtime/live.ts`

Add the scheduler after the orchestrator is started:

```typescript
import { insertPortfolioSnapshot } from "../adapters/supabase/repositories";

const SNAPSHOT_INTERVAL_MS = 60_000; // every minute

const snapshotTimer = setInterval(async () => {
  const snapshot = portfolioState.getSnapshot();
  await insertPortfolioSnapshot(snapshot);
}, SNAPSHOT_INTERVAL_MS);

// Cancel the timer in the existing shutdown handler before process.exit:
clearInterval(snapshotTimer);
```

---

## Part 6 — Implement the Strategies Controller

The strategies routes are wired but the controller functions are stubs. Replace them with
working implementations that delegate to the orchestrator via the app context.

**File:** `backend/src/app/controllers/strategiesController.ts`

```typescript
import type { Request, Response } from "express";
import { PairsStrategy } from "../../strategies/pairs/pairsStrategy";
import { createPairsConfig } from "../../strategies/pairs/pairsConfig";
import {
  insertStrategyRun,
  updateStrategyRun,
  getAllStrategyRuns,
} from "../../adapters/supabase/repositories";
import { getCtx } from "../context";
import { logger } from "../../utils/logger";
import { newId } from "../../utils/ids";
import { nowMs } from "../../utils/time";
import type { StrategyRun } from "../../types/strategy";

export async function listStrategyRuns(_req: Request, res: Response): Promise<void> {
  try {
    const runs = await getAllStrategyRuns();
    res.json(runs);
  } catch (err) {
    logger.error("listStrategyRuns error", { err });
    res.status(500).json({ error: "Failed to fetch strategy runs" });
  }
}

export async function startStrategyRun(req: Request, res: Response): Promise<void> {
  const body = req.body as { strategyConfig: any };
  if (!body.strategyConfig) {
    res.status(400).json({ error: "strategyConfig is required" });
    return;
  }

  const { orchestrator } = getCtx(req);
  const config = createPairsConfig(
    body.strategyConfig.leg1Symbol,
    body.strategyConfig.leg2Symbol,
    body.strategyConfig,
  );

  const strategy = new PairsStrategy(config);
  orchestrator.registerStrategy(strategy);
  strategy.start();

  const run: StrategyRun = {
    id: newId(),
    strategyId: config.id,
    type: config.type,
    name: config.name,
    status: "running",
    startedAt: nowMs(),
    config,
    signalCount: 0,
    orderCount: 0,
    realizedPnl: 0,
  };

  await insertStrategyRun(run);
  logger.info("startStrategyRun: started", { id: run.id, name: config.name });
  res.status(201).json(run);
}

export async function stopStrategyRun(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const { orchestrator } = getCtx(req);

  orchestrator.stopStrategy(id);
  await updateStrategyRun(id, { status: "stopped", stoppedAt: nowMs() });

  logger.info("stopStrategyRun: stopped", { id });
  res.json({ message: `Strategy run ${id} stopped` });
}
```

---

## Part 7 — Build the Live Trading Entry Point

Paper trading uses `runtime/live.ts` with `ALPACA_TRADING_MODE=paper`. Live trading
requires a separate execution sink pointing at the real Alpaca endpoint, plus an explicit
opt-in guard so live orders cannot be sent by accident.

### Step 1 — Create the live execution sink

**File:** `backend/src/core/execution/liveExecution.ts`

```typescript
import type { IExecutionSink } from "./executionEngine";
import type { AlpacaOrderExecutionAdapter } from "../../adapters/alpaca/orderExecution";
import type { OrderIntent } from "../../types/orders";

export class LiveExecutionSink implements IExecutionSink {
  constructor(private readonly adapter: AlpacaOrderExecutionAdapter) {}

  async submitOrder(intent: OrderIntent): Promise<void> {
    return this.adapter.submitOrder(intent);
  }

  async cancelOrder(brokerOrderId: string): Promise<void> {
    return this.adapter.cancelOrder(brokerOrderId);
  }
}
```

### Step 2 — Create `runtime/live-trading.ts`

**File:** `backend/src/runtime/live-trading.ts`

This mirrors `runtime/live.ts` exactly except it uses the live Alpaca base URL, the live
stream URL, and `LiveExecutionSink`. It refuses to start unless the feature gate is
explicitly set.

```typescript
import "dotenv/config";
import { env } from "../config/env";
import { logger } from "../utils/logger";

if (!env.enableLiveTrading) {
  logger.error("runtime/live-trading: ENABLE_LIVE_TRADING is not set to true — refusing to start");
  process.exit(1);
}

if (env.alpacaTradingMode !== "live") {
  logger.error("runtime/live-trading: ALPACA_TRADING_MODE must be 'live' — refusing to start");
  process.exit(1);
}

import { EventBus } from "../core/engine/eventBus";
import { Orchestrator } from "../core/engine/orchestrator";
import { ExecutionEngine } from "../core/execution/executionEngine";
import { LiveExecutionSink } from "../core/execution/liveExecution";
import { RiskEngine } from "../core/risk/riskEngine";
import { SymbolStateManager } from "../core/state/symbolState";
import { PortfolioStateManager } from "../core/state/portfolioState";
import { OrderStateManager } from "../core/state/orderState";
import { AlpacaMarketDataAdapter } from "../adapters/alpaca/marketData";
import { AlpacaOrderExecutionAdapter } from "../adapters/alpaca/orderExecution";
import { createApp } from "../app/index";
import type { AppContext } from "../app/context";
import {
  insertOrder, insertFill, updateOrder,
  insertStrategyRun, updateStrategyRun, insertPortfolioSnapshot,
} from "../adapters/supabase/repositories";
import { nowMs } from "../utils/time";

const eventBus        = new EventBus();
const symbolState     = new SymbolStateManager();
const portfolioState  = new PortfolioStateManager(100_000);
const orderState      = new OrderStateManager();
const riskEngine      = new RiskEngine(portfolioState, orderState);

const marketDataAdapter = new AlpacaMarketDataAdapter(eventBus, {
  apiKey:    env.alpacaApiKey,
  apiSecret: env.alpacaApiSecret,
  streamUrl: env.alpacaLiveStreamUrl,
});

const orderAdapter = new AlpacaOrderExecutionAdapter(eventBus, {
  apiKey:    env.alpacaApiKey,
  apiSecret: env.alpacaApiSecret,
  baseUrl:   env.alpacaLiveBaseUrl,
  streamUrl: env.alpacaLiveStreamUrl,
  mode:      "live",
});

const executionEngine = new ExecutionEngine(new LiveExecutionSink(orderAdapter));
const orchestrator    = new Orchestrator(
  eventBus, symbolState, portfolioState, orderState, riskEngine, executionEngine,
);

// Persistence hooks — IS_PAPER is false for live
eventBus.on("ORDER_SUBMITTED", async (event) => {
  await insertOrder(event.order, false);
});
eventBus.on("ORDER_FILLED", async (event) => {
  await insertFill(event.fill, false);
  await updateOrder(event.orderId, {
    status: event.status,
    filledQty: event.filledQty,
    avgFillPrice: event.avgFillPrice,
    closedAt: event.fill.ts,
  });
});
eventBus.on("ORDER_CANCELED", async (event) => {
  await updateOrder(event.orderId, { status: "canceled", closedAt: nowMs() });
});

const snapshotTimer = setInterval(async () => {
  await insertPortfolioSnapshot(portfolioState.getSnapshot());
}, 60_000);

const ctx: AppContext = { orchestrator, symbolState, portfolioState, orderState, riskEngine };
const app = createApp(ctx);
const server = app.listen(env.port, () => {
  logger.info(`runtime/live-trading: LIVE API server on port ${env.port}`);
});

async function shutdown(): Promise<void> {
  logger.warn("runtime/live-trading: shutting down");
  clearInterval(snapshotTimer);
  orchestrator.stop();
  await marketDataAdapter.disconnect();
  server.close(() => process.exit(0));
}

process.on("SIGINT",  shutdown);
process.on("SIGTERM", shutdown);
```

### Step 3 — Add the npm script

**File:** `backend/package.json`

```json
"dev:live-trading": "nodemon --exec ts-node src/runtime/live-trading.ts",
"start:live-trading": "node dist/runtime/live-trading.js"
```

---

## Part 8 — Smoke Test: Paper Trading

### 8a. Start the paper runtime

```bash
cd backend
npm run dev:live
```

You should see:

```
[INFO] Orchestrator: started {"mode":"paper"}
[INFO] runtime/live: paper API server on port 8080
```

### 8b. Check system health

```bash
curl http://localhost:8080/health
```

Expected:

```json
{ "status": "ok" }
```

### 8c. Start a pairs strategy

```bash
curl -X POST http://localhost:8080/api/strategies/start \
  -H "Content-Type: application/json" \
  -d '{
    "strategyConfig": {
      "type": "pairs_trading",
      "leg1Symbol": "SPY",
      "leg2Symbol": "QQQ",
      "entryZScore": 2.0,
      "exitZScore": 0.5
    }
  }'
```

Expected:

```json
{ "id": "<run-id>", "status": "running", "name": "Pairs SPY/QQQ", ... }
```

Confirm the row appears in Supabase → `strategy_runs`.

### 8d. Check portfolio state

```bash
curl http://localhost:8080/api/portfolio
```

Expected: a snapshot object showing initial cash ($100,000), zero positions, and equity
equal to initial capital.

### 8e. List strategy runs

```bash
curl http://localhost:8080/api/strategies
```

Expected: a JSON array containing the run started in step 8c with `status: "running"`.

### 8f. Wait for a signal and verify fill persistence

Leave the server running through a few minutes of market hours. When the pairs z-score
crosses the entry threshold you will see:

```
[INFO] PairsStrategy: entry signal {"direction":"short_spread","zScore":"2.01",...}
[INFO] ExecutionEngine: submitting order {"symbol":"SPY","side":"sell",...}
[INFO] ExecutionEngine: submitting order {"symbol":"QQQ","side":"buy",...}
```

Shortly after, Alpaca returns fills:

```
[INFO] ORDER_FILLED {"symbol":"SPY",...}
[INFO] ORDER_FILLED {"symbol":"QQQ",...}
```

Confirm rows appear in Supabase → `orders` and `fills`.

### 8g. Stop the strategy

Replace `<run-id>` with the id from step 8c:

```bash
curl -X POST http://localhost:8080/api/strategies/<run-id>/stop
```

Expected:

```json
{ "message": "Strategy run <run-id> stopped" }
```

Confirm `strategy_runs.status` updates to `"stopped"` in Supabase.

---

## Part 9 — Smoke Test: Live Trading

> **Warning:** This sends real orders to Alpaca using real money. Only proceed after
> paper trading has been validated over multiple sessions and you have confirmed the
> desired risk limits.

### 9a. Set environment variables

In `.env`:

```
ALPACA_TRADING_MODE=live
ENABLE_LIVE_TRADING=true
MAX_POSITION_SIZE_USD=5000
MAX_NOTIONAL_EXPOSURE_USD=20000
```

### 9b. Start the live runtime

```bash
npm run dev:live-trading
```

You should see:

```
[INFO] runtime/live-trading: LIVE API server on port 8080
```

If either env var is missing the process exits immediately with an error.

### 9c. Verify orders are tagged correctly

After a fill, query the orders table in Supabase:

```sql
select id, symbol, side, status, is_paper
from orders
order by "submittedAt" desc
limit 5;
```

Live orders will have `is_paper = false`. Paper orders from previous sessions will have
`is_paper = true`.

### 9d. Confirm fills appear in Alpaca dashboard

Log in to alpaca.markets → Live Trading → Activity. Orders submitted via `npm run
dev:live-trading` should appear here within seconds of the fill event.

---

## Checklist

- [ ] All four Supabase tables created (`strategy_runs`, `orders`, `fills`, `portfolio_snapshots`)
- [ ] `createApp()` accepts and stores `AppContext` on `app.locals.ctx`
- [ ] `runtime/live.ts` builds `AppContext` and passes it to `createApp()`
- [ ] `getCtx()` helper added to `app/context.ts`
- [ ] ORDER_SUBMITTED hook persists orders to DB
- [ ] ORDER_FILLED hook persists fills and updates order row
- [ ] ORDER_CANCELED hook updates order status
- [ ] Portfolio snapshot scheduler runs every 60 seconds
- [ ] `strategiesController.ts` fully implemented (list, start, stop)
- [ ] `LiveExecutionSink` created in `core/execution/liveExecution.ts`
- [ ] `runtime/live-trading.ts` created with dual feature gate
- [ ] `dev:live-trading` and `start:live-trading` npm scripts added
- [ ] Paper smoke test: strategy starts, signal fires, orders and fills appear in Supabase
- [ ] Live smoke test: `is_paper = false` on orders, fills visible in Alpaca dashboard
