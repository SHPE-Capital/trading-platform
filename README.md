# SHPE Capital — Trading Platform

An event-driven algorithmic trading platform built for pairs trading, backtesting, and market replay. The backend processes real-time market data through a shared engine that runs identically in live, backtest, and replay modes. The frontend provides a full dashboard for monitoring strategy health, portfolio state, and historical analysis.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Project Structure](#project-structure)
- [Pairs Trading Strategy](#pairs-trading-strategy)
- [Future Strategies](#future-strategies)
- [Setup Instructions](#setup-instructions)
- [Running the Platform](#running-the-platform)
- [API Routes](#api-routes)

---

## Architecture Overview

```
Market Data (Alpaca WS)
        │
        ▼
  AlpacaAdapter          ← Normalizes raw Alpaca events into TradingEvents
        │
        ▼
    EventBus             ← Synchronous, in-order pub/sub (no async dispatch)
        │
   ┌────┴────┐
   ▼         ▼
SymbolState  Orchestrator
(rolling     │
 windows,    ├── Strategy.evaluate()  ← Reads SymbolState, emits StrategySignal
 quotes)     │
             ├── RiskEngine           ← Kill switch, exposure limits, cooldowns
             │
             └── IExecutionSink       ← PaperExecution (Alpaca) or SimulatedExecution (backtest)
```

**Key design principles:**

- **Event-driven, synchronous dispatch** — the EventBus delivers events in the order they are published, with no async gaps. This makes backtest replay deterministic and reproducible.
- **In-memory state first** — rolling windows, quotes, and positions live in memory. The database is only written for persistence and audit (fills, snapshots, event logs).
- **Shared engine across modes** — the same Orchestrator, strategies, and risk checks run in live trading, backtesting, and replay. Mode differences are isolated to the entry point (`runtime/live.ts`, `runtime/backtest.ts`, `runtime/replay.ts`) and the execution sink.
- **Provider abstraction** — all Alpaca-specific logic lives in `adapters/alpaca/`. The core engine only sees normalized `TradingEvent` types.

---

## Project Structure

```
trading-platform/
├── backend/
│   ├── src/
│   │   ├── adapters/
│   │   │   ├── alpaca/          # WebSocket market data, order execution, event normalizer
│   │   │   └── supabase/        # Database client and repository layer
│   │   ├── app/
│   │   │   ├── controllers/     # Request handlers for each resource
│   │   │   ├── middleware/      # Request logger, error handler
│   │   │   └── routes/          # Express route definitions
│   │   ├── config/              # Environment variable loading, defaults
│   │   ├── core/
│   │   │   ├── backtest/        # BacktestEngine, historical bar loader
│   │   │   ├── engine/          # EventBus, Orchestrator
│   │   │   ├── execution/       # IExecutionSink, PaperExecution, SimulatedExecution
│   │   │   ├── replay/          # ReplayEngine (step, play, pause, set_speed)
│   │   │   ├── risk/            # RiskEngine (kill switch, limits, cooldowns)
│   │   │   └── state/           # RollingTimeWindow, SymbolState, PortfolioState, OrderState
│   │   ├── db/
│   │   │   ├── migrations/      # 001_initial.sql — full schema DDL
│   │   │   ├── schema/          # TypeScript table type definitions
│   │   │   └── seed/            # Instrument seed data
│   │   ├── runtime/
│   │   │   ├── live.ts          # Bootstraps live trading mode
│   │   │   ├── backtest.ts      # Bootstraps backtest mode
│   │   │   └── replay.ts        # Bootstraps replay mode
│   │   ├── services/
│   │   │   ├── aggregations/    # OHLCV, returns aggregation
│   │   │   └── indicators/      # SMA, EMA, RSI, volatility, z-score
│   │   ├── strategies/
│   │   │   ├── base/            # IStrategy interface, BaseStrategy abstract class
│   │   │   ├── pairs/           # PairsStrategy (fully implemented)
│   │   │   ├── momentum/        # Placeholder
│   │   │   ├── arbitrage/       # Placeholder
│   │   │   └── marketMaking/    # Placeholder
│   │   ├── types/               # Shared TypeScript types (events, orders, portfolio, …)
│   │   └── utils/               # Logger, ID generation, time helpers
│   ├── .env.example
│   ├── package.json
│   └── tsconfig.json
│
└── frontend/
    ├── app/                     # Next.js 16 App Router pages
    │   ├── dashboard/           # System health, portfolio summary, equity curve
    │   ├── strategies/          # Strategy list + launch form; [id] detail page
    │   ├── portfolio/           # Positions, orders, fills tabs
    │   ├── backtest/            # Config form + results panel
    │   └── replay/              # Session selector + playback controls
    ├── components/
    │   ├── cards/               # PortfolioSummaryCard, StrategyStatusCard, SystemHealthCard
    │   ├── charts/              # PnLChart, SpreadChart, ZScoreChart
    │   ├── controls/            # StrategyControls, ReplayControls
    │   ├── layout/              # Navbar, Sidebar
    │   └── tables/              # OrdersTable, FillsTable, PositionsTable
    ├── features/
    │   ├── strategy/            # StrategyForm, StrategyList
    │   ├── backtest/            # BacktestForm, BacktestResults
    │   ├── portfolio/           # PortfolioMetrics
    │   └── replay/              # ReplayPlayer
    ├── hooks/                   # usePortfolio, useStrategies, useBacktest, useReplay, useWebSocket
    ├── services/                # Typed fetch wrappers for each API resource
    ├── state/                   # Context + useReducer stores (strategy, portfolio, system)
    ├── types/                   # Frontend mirror of backend API types
    ├── config/                  # Runtime config (API URLs, feature flags)
    ├── .env.example
    └── package.json
```

---

## Pairs Trading Strategy

Pairs trading exploits the tendency of two historically correlated instruments to revert to a stable price relationship after temporary divergences. The platform implements a **z-score-driven mean reversion** approach.

### Core Idea

Given two instruments `leg1` and `leg2` with a known linear relationship, the **spread** is defined as:

```
spread = price_leg1 - (hedgeRatio × price_leg2)
```

Over time, this spread oscillates around a mean. When it deviates far enough — measured in standard deviations (z-score) — we bet on reversion.

### Z-Score

The z-score normalizes the spread against its recent history:

```
z = (spread - mean(spread)) / std(spread)
```

Statistics are computed over a rolling time window (default: 1 hour). A minimum of 30 observations is required before any signal is generated, ensuring the statistics are meaningful.

### Signal Logic

| Condition | Action |
|---|---|
| `z < -entryZScore` | **Enter long spread** — buy leg1, sell leg2 (spread is unusually low, expect it to rise) |
| `z > +entryZScore` | **Enter short spread** — sell leg1, buy leg2 (spread is unusually high, expect it to fall) |
| `\|z\| < exitZScore` | **Exit position** — spread has reverted to the mean |
| `\|z\| > stopLossZScore` | **Stop-loss exit** — spread has moved further against us |
| Held longer than `maxHoldingTimeMs` | **Time-based exit** — forced close regardless of z-score |

### Default Parameters

| Parameter | Default | Description |
|---|---|---|
| `entryZScore` | `2.0` | Z-score magnitude required to enter a trade |
| `exitZScore` | `0.5` | Z-score magnitude at which to take profit |
| `stopLossZScore` | `4.0` | Emergency exit threshold |
| `maxHoldingTimeMs` | `86_400_000` (24h) | Maximum time to hold a position open |
| `rollingWindowMs` | `3_600_000` (1h) | Lookback window for spread statistics |
| `minObservations` | `30` | Minimum data points before trading |
| `tradeNotionalUsd` | `5_000` | Dollar value per leg |
| `hedgeRatioMethod` | `"fixed"` | `"fixed"` or `"rolling_ols"` |
| `fixedHedgeRatio` | `1.0` | Static hedge ratio (used when method is `"fixed"`) |
| `cooldownMs` | `60_000` (1 min) | Pause after exiting before re-entry is allowed |

### Hedge Ratio

The hedge ratio controls how many units of `leg2` offset one unit of `leg1`. Two methods are supported:

- **`fixed`** — a constant ratio supplied at configuration time (e.g. `1.0` for dollar-neutral, `0.5` for a sector-adjusted pair). Simple and robust.
- **`rolling_ols`** — estimated via rolling ordinary least-squares regression over the spread window. Adapts to regime changes but introduces estimation noise.

For production use, `fixed` with a cointegration-derived ratio is recommended unless the pair is known to have a drifting relationship.

### Execution

When a signal is generated, the Orchestrator creates **two orders** — one per leg — using the `PairsSignalMeta.counterpartSymbol` and `counterpartDirection` fields attached to the signal. Sizing is derived from `tradeNotionalUsd` divided by the current mid-price of each leg.

All orders pass through the `RiskEngine` before reaching the execution sink:

- **Kill switch** — halts all new orders globally
- **Max position size** — hard cap per instrument
- **Max notional exposure** — total portfolio exposure ceiling
- **Short-selling check** — configurable allow/deny
- **Order cooldown** — per-strategy re-entry throttle

### Position States

```
flat → long_spread or short_spread → closing → flat
```

The strategy tracks its own `PairsPositionState` independently of the order layer, preventing duplicate entries and ensuring clean exits.

### Code Locations

| File | Purpose |
|---|---|
| [backend/src/strategies/pairs/pairsStrategy.ts](backend/src/strategies/pairs/pairsStrategy.ts) | Core evaluate loop — spread computation, signal generation |
| [backend/src/strategies/pairs/pairsTypes.ts](backend/src/strategies/pairs/pairsTypes.ts) | All pairs-specific TypeScript types |
| [backend/src/strategies/pairs/pairsConfig.ts](backend/src/strategies/pairs/pairsConfig.ts) | Defaults and `createPairsConfig()` factory |
| [backend/src/services/indicators/zscore.ts](backend/src/services/indicators/zscore.ts) | `computeZScore`, `computeMean`, `computeStdDev` |
| [backend/src/core/state/rollingWindow.ts](backend/src/core/state/rollingWindow.ts) | `RollingTimeWindow<T>` — time-based eviction with binary search |

---

## Future Strategies

The `strategies/` directory is structured to accept new strategies by extending `BaseStrategy` and implementing the `IStrategy` interface. Placeholder files exist for each:

- **Momentum** (`strategies/momentum/`) — Enter in the direction of a strong price trend, exit when momentum fades. Planned indicators: RSI, EMA crossovers, ATR-based stops.
- **Statistical Arbitrage** (`strategies/arbitrage/`) — Generalization of pairs trading to baskets of instruments; multi-leg spread with cointegration testing.
- **Market Making** (`strategies/marketMaking/`) — Post resting limit orders on both sides of the book; profit from the bid-ask spread. Requires Level 2 quote data.
- **Neural Network** — ML-based signal generation; planned as a separate inference service that publishes signals to the EventBus rather than living inside the engine directly.

---

## Setup Instructions

### Prerequisites

- Node.js 20+
- A [Supabase](https://supabase.com) project (free tier works for development)
- An [Alpaca](https://alpaca.markets) account (paper trading is free)

### 1. Clone and install

```bash
git clone <repo-url>
cd trading-platform

# Backend
cd backend && npm install

# Frontend
cd ../frontend && npm install
```

### 2. Configure the backend

```bash
cd backend
cp .env.example .env
```

Edit `.env` with your credentials:

| Variable | Where to find it |
|---|---|
| `ALPACA_API_KEY` / `ALPACA_API_SECRET` | Alpaca dashboard → API Keys |
| `ALPACA_TRADING_MODE` | `paper` (default) or `live` |
| `SUPABASE_URL` | Supabase project → Settings → API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase project → Settings → API → service_role key |

### 3. Run the database migration

In the Supabase dashboard, open the SQL editor and run:

```
backend/src/db/migrations/001_initial.sql
```

This creates all required tables: `instruments`, `strategy_runs`, `orders`, `fills`, `portfolio_snapshots`, `backtest_results`, `event_logs`.

### 4. Configure the frontend

```bash
cd frontend
cp .env.example .env.local
```

The defaults in `.env.example` point to `localhost:3001` and are correct for local development. No changes needed to start.

---

## Running the Platform

All three modes run the same core engine; only the entry point and execution sink differ.

### Development (with hot reload)

```bash
# Terminal 1 — backend (paper trading mode)
cd backend && npm run dev:live

# Terminal 2 — frontend
cd frontend && npm run dev
```

Frontend: [http://localhost:3000](http://localhost:3000)  
Backend API: [http://localhost:3001/api](http://localhost:3001/api)

### Other backend modes

```bash
# Run a backtest (configure parameters in runtime/backtest.ts)
npm run dev:backtest

# Run the replay engine
npm run dev:replay
```

### Production build

```bash
# Backend
cd backend && npm run build && npm run start:live

# Frontend
cd frontend && npm run build && npm run start
```

---

## API Routes

All routes are prefixed with `/api`.

| Method | Path | Description |
|---|---|---|
| `GET` | `/system/status` | Engine health, uptime, mode |
| `GET` | `/strategies` | List all strategy runs |
| `POST` | `/strategies` | Launch a new strategy |
| `DELETE` | `/strategies/:id` | Stop a running strategy |
| `GET` | `/portfolio/snapshot` | Current portfolio snapshot |
| `GET` | `/portfolio/positions` | Open positions |
| `GET` | `/portfolio/orders` | Recent orders |
| `GET` | `/portfolio/fills` | Recent fills |
| `GET` | `/portfolio/equity-curve` | Equity curve data points |
| `POST` | `/backtest/run` | Run a backtest, returns results |
| `GET` | `/backtest/results` | List past backtest results |
| `GET` | `/backtest/results/:id` | Single backtest result detail |
| `POST` | `/replay/sessions` | Create a replay session |
| `POST` | `/replay/sessions/:id/control` | Send play/pause/step/reset/set_speed |
| `GET` | `/replay/sessions/:id` | Get session state |
| `GET` | `/market-data/quotes/:symbol` | Latest quote for a symbol |
| `GET` | `/market-data/bars/:symbol` | Historical bars for a symbol |
