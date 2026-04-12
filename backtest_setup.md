# Issue #9 — Backtest Pipeline End-to-End

Complete the steps below in order. Each section is a hard blocker for the ones that follow it.

---

## Part 1 — Environment Setup

### 1. Install dependencies

```bash
cd backend
npm install
```

### 2. Create the backend `.env` file

```bash
cp .env.example .env
```

Open `backend/.env` and fill in the following values. Leave everything else at its default.

```
ALPACA_API_KEY=<your paper trading key>
ALPACA_API_SECRET=<your paper trading secret>
ALPACA_TRADING_MODE=paper

SUPABASE_URL=https://<your-project-id>.supabase.co
SUPABASE_ANON_KEY=<anon public key>
SUPABASE_SERVICE_ROLE_KEY=<service_role key>
DATABASE_URL=postgresql://postgres:<password>@db.<your-project-id>.supabase.co:5432/postgres
```

**Where to find these values:**

- **Alpaca keys** — log in to alpaca.markets → Paper Trading → API Keys → generate a new key pair
- **Supabase keys** — Supabase dashboard → Project Settings → API. Copy the Project URL, `anon public` key, and `service_role` key. The `DATABASE_URL` password is the one set when creating the project.

> The `SERVICE_ROLE_KEY` bypasses Row Level Security. Never commit `.env` to git — it is already in `.gitignore`.

### 3. Resolve the DI wiring blocker

The issue description flags a "DI wiring issue" as a prerequisite. Here is what it actually means and how it is resolved:

`config/env.ts` calls `require("SUPABASE_URL")`, `require("ALPACA_API_KEY")`, etc. at **import time** — not lazily. This means the server process crashes immediately at startup with `Missing required environment variable: ...` if any of those keys are absent. The backtest controller, CLI entry point, and Supabase client all depend on this module loading cleanly.

**The blocker is resolved entirely by completing Step 2 above.** No code changes are needed. Once `.env` is filled in, the server starts, the Supabase client initializes on its first call, and `POST /api/backtests/run` becomes reachable. The backtest controller creates its own isolated `BacktestEngine` per request and does not need the live `Orchestrator`.

### 4. Create the Supabase `backtest_results` table

Open the Supabase dashboard → SQL Editor → New query. Paste and run:

```sql
create table if not exists backtest_results (
  id              uuid         primary key,
  config          jsonb        not null,
  status          text         not null,
  started_at      bigint       not null,
  completed_at    bigint,
  error_message   text,
  final_portfolio jsonb        not null,
  metrics         jsonb        not null,
  equity_curve    jsonb        not null,
  orders          jsonb        not null,
  fills           jsonb        not null,
  event_count     integer      not null,
  inserted_at     timestamptz  not null default now()
);
```

Verify the table appears under Table Editor before continuing.

---

## Part 2 — Task 1: Smoke Test the Bar Loader

Run the backtest CLI entry point. This fetches 1-min bars for SPY and QQQ over all of 2023.

```bash
npm run dev:backtest
```

**Expected log output (in order):**

```
BacktestLoader: loaded bars { symbol: 'SPY', count: <N>, timeframe: '1Min' }
BacktestLoader: loaded bars { symbol: 'QQQ', count: <N>, timeframe: '1Min' }
```

Expected bar counts: roughly 97,000–100,000 per symbol (252 trading days × ~390 1-min bars/day).

After both symbols load, the engine will run through all bars and attempt to persist to Supabase:

```
runtime/backtest: completed { id: '...', totalReturn: '0.00%', ... }
runtime/backtest: result persisted { id: '...' }
```

> `totalReturn` will be near 0% at this point because `_computeQty()` always returns 1 and
> metrics are placeholders — that is expected and will be fixed in Tasks 2 and 3.

**Confirm in Supabase** → Table Editor → `backtest_results` that a row exists with `status = 'completed'`.

**Common errors:**

| Error | Cause | Fix |
|---|---|---|
| `Missing required environment variable: ALPACA_API_KEY` | `.env` not loaded or key missing | Re-check Part 1 Step 2 |
| `403 Forbidden` from Alpaca | Wrong key type or key not activated | Use paper trading keys only |
| `401 Unauthorized` | Typo in key or secret | Copy-paste directly from Alpaca dashboard |
| `insertBacktestResult failed` | `backtest_results` table does not exist | Re-run Part 1 Step 4 SQL |

---

## Part 3 — Task 2: Fix `_computeQty()` in `pairsStrategy.ts`

**File:** `backend/src/strategies/pairs/pairsStrategy.ts`

### The problem

`_computeQty()` at line 273 always returns `1`. It has no access to the current price because it is a parameterless method with no reference to `symbolState`. The fix requires two changes:

### Step 1 — Add `latestLeg1Price` to `PairsInternalState`

**File:** `backend/src/strategies/pairs/pairsTypes.ts`

Add one field to `PairsInternalState`:

```typescript
/** Most recent leg1 price used for position sizing */
latestLeg1Price: number | null;
```

### Step 2 — Cache the price during `evaluate()`

In `pairsStrategy.ts`, the `evaluate()` method resolves `price1` at line 69 but does a null guard at line 76: `if (price1 === null || price2 === null) return null;`. The cache must go **after** that guard (line 78 onwards) — otherwise `price1` could still be null and the TypeScript type will complain.

Add the cache line at line 78, after the null check:

```typescript
// Line 76: if (price1 === null || price2 === null) return null;  ← must be BEFORE this line
// Line 77: (blank)
// Line 78: add here ↓
this.state.latestLeg1Price = price1;

// Line 79: // Update hedge ratio if using rolling OLS ...
const hedgeRatio = this._getHedgeRatio(price1, price2);
```

### Step 3 — Update `_initState()`

Add the new field to the initial state object returned by `_initState()` at line 279:

```typescript
latestLeg1Price: null,
```

### Step 4 — Implement `_computeQty()`

Replace the placeholder at line 273:

```typescript
private _computeQty(): number {
  const price = this.state.latestLeg1Price;
  if (!price || price <= 0) return 0;
  return Math.floor(this.pairsConfig.tradeNotionalUsd / price);
}
```

**Verify:** After this change, re-run `npm run dev:backtest`. Orders in the result stored in Supabase should now have `qty > 1` on most fills (SPY is ~$400–500, so `$5000 / $450 ≈ 11 shares`).

---

## Part 4 — Task 3: Implement Performance Metrics

**File:** `backend/src/core/backtest/backtestEngine.ts`

The `_computeMetrics()` method at line 145 has `winRate`, `totalTrades`, `avgWin`, and `avgLoss` hardcoded to `0`. The fills are already available — `orderState.getAllOrders().flatMap(o => o.fills)` is passed into the result at line 128.

Update `_computeMetrics()` to accept the fills array and compute the real values.

### Step 1 — Update the method signature

Change the signature to accept fills:

```typescript
private _computeMetrics(
  equityCurve: PortfolioSnapshot[],
  fills: Fill[],
  initialCapital: number,
  periodStart: number,
  periodEnd: number,
)
```

Add the `Fill` import at the top of the file:

```typescript
import type { Fill } from "../../types/orders";
```

### Note on the early-return branch

`_computeMetrics` has a second return path at line 151 for when `equityCurve.length === 0`. That path still returns zeros for all trade metrics — this is correct and does not need to change. No bars means no fills means no trades. TypeScript will not complain because the `fills` parameter is simply unused in that branch.

### Step 2 — Compute trade-level metrics from fills

Fills are individual executions. A completed round-trip trade is a `buy` fill followed by a `sell` fill (or vice versa for a short). The simplest approach: pair fills by order side within each strategy signal.

Add this logic inside `_computeMetrics()`, replacing the hardcoded zeros:

```typescript
// Group fills into round-trip P&L values
// Each paired buy+sell on the same symbol is one trade
const pnlPerTrade: number[] = [];
const buyMap = new Map<string, Fill[]>(); // symbol → open buy fills

for (const fill of fills) {
  if (fill.side === "buy") {
    const existing = buyMap.get(fill.symbol) ?? [];
    existing.push(fill);
    buyMap.set(fill.symbol, existing);
  } else {
    const buys = buyMap.get(fill.symbol);
    if (buys && buys.length > 0) {
      const matchedBuy = buys.shift()!;
      const pnl = (fill.price - matchedBuy.price) * fill.qty - fill.commission - matchedBuy.commission;
      pnlPerTrade.push(pnl);
    }
  }
}

const totalTrades = pnlPerTrade.length;
const wins = pnlPerTrade.filter((p) => p > 0);
const losses = pnlPerTrade.filter((p) => p <= 0);
const winRate = totalTrades > 0 ? wins.length / totalTrades : 0;
const avgWin = wins.length > 0 ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / losses.length : 0;
```

### Step 3 — Pass fills from the `run()` call site

In the `run()` method at line 125, update the `_computeMetrics()` call to pass fills.
Since `result` is not yet built at that point, extract `fills` first:

```typescript
const fills = orderState.getAllOrders().flatMap((o) => o.fills);

const result: BacktestResult = {
  // ...
  fills,
  metrics: this._computeMetrics(equityCurve, fills, config.initialCapital, startedAt, completedAt),
  // ...
};
```

**Verify:** Re-run `npm run dev:backtest`. The logged `totalReturn` should now be non-zero, and the Supabase row's `metrics` column should contain real values for `winRate`, `totalTrades`, `avgWin`, and `avgLoss`.

---

## Part 5 — Task 4: Test the HTTP Endpoint

The issue goal is `POST /api/backtests/run` working end-to-end, not just the CLI. After
completing Tasks 2 and 3, verify the HTTP path as well.

### Step 1 — Start the API server

In a terminal:

```bash
npm run dev
```

You should see:

```
Backend API server started on port 3001
```

### Step 2 — Trigger a backtest via HTTP

In a second terminal:

```bash
curl -X POST http://localhost:3001/api/backtests/run \
  -H "Content-Type: application/json" \
  -d '{
    "name": "SPY/QQQ HTTP test",
    "strategyConfig": {
      "type": "pairs_trading",
      "symbols": ["SPY", "QQQ"]
    },
    "startDate": "2023-01-01T00:00:00Z",
    "endDate": "2023-03-31T23:59:59Z"
  }'
```

> Using a 3-month window here instead of the full year to keep the HTTP test fast (~25,000 bars vs 200,000).

Expected immediate response (HTTP 202):

```json
{ "backtestId": "<uuid>", "message": "Backtest queued" }
```

The backtest runs in the background. Watch the server terminal for:

```
BacktestLoader: loaded bars { symbol: 'SPY', ... }
BacktestLoader: loaded bars { symbol: 'QQQ', ... }
BacktestEngine: completed { ... }
Backtest completed and saved { id: '<uuid>' }
```

### Step 3 — Retrieve the result via HTTP

```bash
curl http://localhost:3001/api/backtests/<uuid>
```

Replace `<uuid>` with the `backtestId` from the 202 response. Expected: a full JSON
`BacktestResult` with non-zero `metrics.totalTrades` and a non-empty `equityCurve` array.

Also confirm `GET /api/backtests` lists the result:

```bash
curl http://localhost:3001/api/backtests
```

**Common errors:**

| Error | Cause | Fix |
|---|---|---|
| Server crashes immediately on `npm run dev` | Missing env vars | Re-check Part 1 Steps 2–3 |
| 202 returned but no log output after | `setImmediate` callback failed silently | Check server terminal for error logs |
| Result has `status: 'failed'` | Engine or Supabase error during async run | Check server terminal for `Backtest failed` log line |

---

## Part 6 — Final Verification

Check all of the following before closing the issue:

- [ ] Bar counts for both SPY and QQQ log above 90,000 (full-year CLI run)
- [ ] No errors during bar loading or engine run
- [ ] `totalReturn` in the log is non-zero
- [ ] A row in Supabase `backtest_results` has `status = 'completed'`
- [ ] The `metrics` column has non-zero values for `winRate` and `totalTrades`
- [ ] The `fills` column has entries with `qty > 1`
- [ ] The `equity_curve` column is a non-empty array
- [ ] `POST /api/backtests/run` returns HTTP 202 and a `backtestId`
- [ ] `GET /api/backtests/:id` returns the full result after the background run completes
- [ ] `GET /api/backtests` lists the result
