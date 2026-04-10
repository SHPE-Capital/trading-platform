# Algorithmic Trading Platform – Full System Design

## Overview

This project is an **event-driven algorithmic trading platform** designed to simulate and understand **high-frequency trading (HFT) architecture**, while remaining practical using broker APIs like Alpaca.

The platform is intended to be:
- educational enough to mirror real trading-system design
- simple enough to implement in TypeScript first
- modular enough to evolve toward more advanced providers later
- structured enough to support multiple strategies and multiple execution modes

The system supports:
- **live paper trading**
- **backtesting**
- **replay of historical data**
- **multiple strategies running concurrently**
- **parameterized strategy experimentation**
- **portfolio and order tracking**
- **frontend dashboards for monitoring and control**

The architecture emphasizes:
- low-latency in-memory computation
- event-driven orchestration
- clear separation of concerns
- provider-agnostic adapters
- reuse of the same engine across different modes
- time-based rolling windows shared across strategies

---

# Project Goals
This is a full system for learning how professional trading platforms are structured:
- how live market data flows through an engine
- how strategies consume state and emit signals
- how risk and execution fit into the pipeline
- how replay and backtesting reuse core logic
- how frontend and backend coordinate cleanly
- how rolling windows drive real-time calculations efficiently

The project should feel like an efficient, well-architected research and execution platform.

---

# Core Design Principles

## 1. Event-Driven Architecture

All major components should communicate through events rather than tightly coupled direct calls.

Conceptually:

- market data arrives
- event is normalized
- engine updates in-memory state
- strategy evaluates signal
- risk checks validate or reject
- execution sends or simulates order
- order updates feed back into state
- frontend reads current system state from backend APIs or streams

This allows:
- loose coupling
- easier debugging
- replay support
- backtest/live reuse
- clearer boundaries between layers

---

## 2. Separation of Concerns

Each layer should do one thing well.

Examples:
- `app/` handles HTTP requests
- `adapters/` talk to Alpaca and Supabase
- `core/` owns state and orchestration
- `strategies/` generate trade decisions
- `services/` provide stateless calculations
- `db/` persists data
- `frontend/` renders UI and calls backend APIs

This makes the system easier to reason about and easier to extend.

---

## 3. In-Memory State First

Latency-sensitive state should live in memory, not in the database.

Examples of in-memory state:
- rolling windows
- current quotes
- current spreads
- current strategy state
- open orders
- current positions
- latest portfolio snapshot

The database should be used for:
- persistence
- historical storage
- backtest results
- audit trails
- loading/saving configurations

The live trading loop should not depend on DB round-trips.

---

## 4. Provider Abstraction

The platform starts with Alpaca, but the design should not hardcode Alpaca assumptions into the engine.

The system should make it easy later to add:
- Polygon
- Databento
- Interactive Brokers
- FIX gateways
- custom simulation feeds

The key idea:
- the engine consumes normalized internal events
- adapters translate external provider formats into those events

---

## 5. Reusable Engine Across Modes

The same core engine should be reused across:

- **live paper trading**
- **backtesting**
- **replay**

The differences should be limited to:
- the **event source**
- the **execution sink**
- the **timing model**

Everything else should remain as shared as possible:
- state updates
- indicators
- rolling windows
- strategy logic
- risk checks
- order lifecycle handling

---

## 6. Shared Time-Based Rolling Window Abstraction

A single generic time-based rolling window should be usable across all strategies and all execution modes.

It should:
- store timestamped values
- evict old entries automatically
- support efficient updates
- work for quotes, trades, spreads, midprices, returns, and strategy-specific derived values

This is one of the most important foundational components in the engine.

---

# Technology Stack

## Backend
- **Node.js**
- **TypeScript**
- **Express.js**
- **Supabase / PostgreSQL**
- **Alpaca API**
- optional WebSocket support to frontend for live updates

## Frontend
- **React**
- **TypeScript**
- **Next.js** - use routing and features 
- charting library for price, PnL, and strategy metrics
- component-based dashboard UI

---

# Backend Architecture

## Main Backend Folder Structure

```text
src/

  app/                 // API layer; handles frontend requests and route/controller wiring
  adapters/            // External integrations such as Alpaca and Supabase
  core/                // Core trading engine; state, orchestration, execution, replay, backtest, risk
  strategies/          // Trading algorithms and their logic
  services/            // Stateless math/helpers/transformations
  db/                  // Database layer for persistence
  types/               // Shared TypeScript types/interfaces
  config/              // Environment variables, defaults, system configuration
  utils/               // General-purpose helpers
  runtime/             // Entry points for live, replay, and backtest modes
```

---

## Expanded Backend Folder Structure

```text
src/

  app/                           // Application/API layer
    routes/                      // HTTP routes exposed to frontend
    controllers/                 // Request handlers that call into core/services

  adapters/                      // External integration boundary
    alpaca/                      // Alpaca-specific market data and order execution wrappers
    supabase/                    // Supabase/Postgres persistence layer integration

  core/                          // Core trading engine
    engine/                      // Event bus and orchestrator
    state/                       // In-memory state: rolling windows, symbols, orders, portfolio
    execution/                   // Execution logic for paper/live simulation
    replay/                      // Replay mode engine
    backtest/                    // Backtesting mode engine
    risk/                        // Risk checks and trade guards

  strategies/                    // Modular strategy implementations
    base/                        // Shared strategy interfaces and common abstractions
    pairs/                       // Pairs-trading logic
    momentum/                    // Momentum-based strategy logic
    arbitrage/                   // Arbitrage strategy logic

  services/                      // Pure stateless helpers
    indicators/                  // EMA, z-score, volatility, microstructure metrics
    aggregations/                // OHLCV creation, return calculations, transformations

  db/                            // Database layer
    migrations/                  // Schema migrations
    seed/                        // Seed data for development/testing
    queries/                     // DB queries or repository implementations
    schema/                      // Table definitions and schema organization

  types/                         // Shared backend types

  config/                        // Configuration modules

  utils/                         // Logging, time helpers, generic helpers

  runtime/                       // Startup entry points for different modes
```

---

## Backend Main Folder Summaries

- **app/**  
  API layer; handles requests from frontend and triggers engine actions.

- **adapters/**  
  Connects the system to external services such as Alpaca and Supabase.

- **core/**  
  Core trading engine; manages state, event flow, execution, replay, backtesting, and risk.

- **strategies/**  
  Independent trading algorithms that generate signals.

- **services/**  
  Stateless helper functions for indicators, calculations, and data transformations.

- **db/**  
  Database layer for persistence of runs, positions, fills, configurations, and analytics.

- **types/**  
  Shared TypeScript definitions for system data structures.

- **config/**  
  Centralized environment variables and default runtime settings.

- **utils/**  
  General-purpose helpers such as time formatting, logging, and IDs.

- **runtime/**  
  Entry points for live paper trading, replay mode, and backtesting mode.

---

# Frontend Architecture

## Main Frontend Folder Structure

```text
frontend/

  app/          // App shell, routing, layout, providers
  pages/        // Main views such as dashboard and portfolio
  components/   // Reusable UI components
  features/     // Feature-specific UI modules
  services/     // Backend API communication
  state/        // Global frontend state
  types/        // Shared frontend TypeScript types
  config/       // Frontend configuration
  utils/        // Generic frontend helpers
  hooks/        // Custom React hooks
```

---

## Frontend Main Folder Summaries

- **app/**  
  App shell and global routing/layout layer.

- **pages/**  
  High-level screens such as dashboard, strategy management, portfolio, and backtests.

- **components/**  
  Reusable UI building blocks such as charts, tables, cards, and controls.

- **features/**  
  Feature-specific UI modules such as strategy configuration or live trading controls.

- **services/**  
  Handles API requests to the backend.

- **state/**  
  Manages global frontend state, such as strategy lists and portfolio snapshots.

- **types/**  
  Shared TypeScript types used across the frontend.

- **config/**  
  Frontend environment and application configuration.

- **utils/**  
  Formatting and small helper utilities.

- **hooks/**  
  Custom hooks for data fetching, subscriptions, and reusable logic.

---

# Frontend and Backend Relationship

The frontend and backend should align conceptually:

- **frontend/services** calls **backend/app routes**
- **frontend/state** reflects data derived from **backend/core/state**
- **frontend/features** map naturally to strategy and portfolio workflows
- **frontend/types** should mirror backend contracts where appropriate
- **frontend pages** should expose controls for runtime actions such as starting and stopping strategies

This creates a clean contract between UI and engine.

---

# Backend Layer Responsibilities in Detail

## app/

This is the API layer. It should:
- expose HTTP endpoints for the frontend
- validate request shape
- call into the appropriate backend logic
- return serialized responses

Examples of API responsibilities:
- create strategy run
- stop strategy run
- fetch portfolio snapshot
- fetch historical performance
- trigger a backtest
- request replay mode
- health/status checks

Important rule:
- `app/` should not contain market data handling or strategy logic

---

## adapters/

This layer abstracts external systems.

### Alpaca adapter responsibilities
- connect to market data WebSocket
- subscribe to symbols
- parse incoming quote/trade/bar messages
- normalize messages into internal events
- submit orders
- cancel or replace orders
- listen for trade/order updates

### Supabase adapter responsibilities
- persist orders, fills, snapshots, strategy runs, and backtest outputs
- load instrument metadata or configuration
- expose repository-like functions to the rest of the backend

Important rule:
- no Alpaca-specific message structure should leak into the core engine

---

## core/

This is the most important layer.

It owns:
- in-memory state
- event orchestration
- execution mode handling
- risk checks
- backtesting logic
- replay logic
- runtime coordination

### core/engine/
Contains the event-driven heart of the system.

Responsibilities:
- publish and consume internal events
- coordinate event flow from adapter → state → strategy → execution
- allow different modes to plug in different event sources/sinks

### core/state/
Contains all latency-sensitive in-memory state.

Responsibilities:
- update current symbol state
- manage time-based rolling windows
- maintain order lifecycle state
- maintain portfolio positions and PnL
- maintain strategy runtime state

### core/execution/
Contains the execution engine.

Responsibilities:
- dispatch order intents to the correct execution sink
- support paper/live execution via Alpaca
- support simulated execution for backtests
- normalize execution results back into internal order events

### core/replay/
Contains replay mode logic.

Responsibilities:
- read historical recorded events
- emit them back through the event bus
- preserve deterministic behavior when possible

### core/backtest/
Contains backtest mode logic.

Responsibilities:
- load historical data
- feed normalized events through the same state/strategy/risk pipeline
- simulate fills and portfolio evolution

### core/risk/
Contains risk management logic.

Responsibilities:
- max position size
- max notional exposure
- stale data guards
- duplicate order prevention
- cooldown windows
- simple kill-switch logic

---

## strategies/

This layer defines independent algorithm logic.

Each strategy should:
- consume symbol/portfolio/order state
- read rolling windows and indicator results
- emit an internal signal or order intent

Each strategy should not:
- call external APIs directly
- manage raw WebSockets
- write directly to the database
- mutate unrelated global state

Good strategy design:
- strategy receives normalized inputs
- strategy has parameterized configuration
- strategy is easily testable in isolation

---

## services/

This layer contains pure stateless functions.

Examples:
- EMA
- SMA
- rolling volatility
- z-score
- spread calculation
- microprice
- imbalance
- OHLCV aggregation
- returns/log-returns

These should:
- accept inputs
- return outputs
- avoid side effects
- avoid shared mutable state

---

## db/

This layer is for persistence only.

Possible stored entities:
- strategies
- strategy runs
- order history
- fills
- positions
- portfolio snapshots
- instruments/equities metadata
- backtest runs
- replay sessions
- performance metrics

The database should not be treated as the live source of truth for low-latency state.

---

## types/

This layer holds TypeScript interfaces and domain types.

Examples:
- `QuoteEvent`
- `TradeEvent`
- `BarEvent`
- `OrderIntent`
- `OrderUpdateEvent`
- `PortfolioSnapshot`
- `StrategySignal`
- `StrategyConfig`
- `RollingWindowEntry<T>`

---

## config/

This layer centralizes settings.

Examples:
- Alpaca credentials
- paper vs live endpoints
- rolling-window defaults
- strategy parameter defaults
- database connection settings
- feature flags

---

## utils/

This layer contains generic helpers:
- time formatting
- timestamps
- ID generation
- structured logging
- small utility helpers

---

## runtime/

This layer is where the system actually starts.

Examples:
- start live paper-trading mode
- start replay mode
- start backtest mode

This is a good place for bootstrapping:
- instantiate adapters
- instantiate orchestrator
- register strategies
- connect event source
- choose execution sink

---

# Event-Driven System Design

## Why Event-Driven?

An event-driven system is the cleanest way to support:
- live data streams
- multiple strategies
- asynchronous order updates
- replay
- backtesting
- extensibility

Instead of tightly coupling everything, the engine reacts to well-defined internal events.

---

## Core Internal Event Types

The system should normalize everything into internal event types such as:

- `QUOTE_RECEIVED`
- `TRADE_RECEIVED`
- `BAR_RECEIVED`
- `ORDER_INTENT_CREATED`
- `ORDER_SUBMITTED`
- `ORDER_ACKNOWLEDGED`
- `ORDER_FILLED`
- `ORDER_CANCELED`
- `PORTFOLIO_UPDATED`
- `STRATEGY_SIGNAL_CREATED`
- `RISK_REJECTED`

This gives you a common language across:
- live mode
- replay mode
- backtest mode

---

## Recommended Event Pipeline

General pattern:

1. external source produces data
2. adapter normalizes data into internal event
3. event bus publishes event
4. state layer updates in-memory state
5. strategy layer reacts and may produce signal
6. risk layer validates
7. execution layer sends or simulates
8. resulting order updates are published back to the bus
9. portfolio/order state updates again
10. frontend reads updated state via API or stream

---

# Orchestration Across Execution Modes

A key goal is to keep orchestration shared and mode differences isolated.

---

## 1. Live Paper Trading Orchestration

### Event source
- Alpaca real-time market data stream

### Execution sink
- Alpaca paper trading order API and trade updates stream

### Timing model
- real wall-clock time

### Flow

```text
Alpaca Market Data Stream
  → Alpaca Adapter
  → Normalize to Internal Events
  → Event Bus
  → Symbol/Rolling State Update
  → Strategy Evaluation
  → Risk Checks
  → Paper Execution via Alpaca
  → Order/Trade Updates
  → Portfolio and Order State Update
  → Persist snapshots/results
  → Frontend reads live state
```

### Live mode responsibilities
- maintain active subscriptions
- update rolling windows continuously
- maintain latest portfolio/order state
- prevent duplicate or invalid orders
- expose status and results to frontend

### Important design rule
The strategy should never know whether it is in paper or live mode. It should only emit signal/order intents.

---

## 2. Backtest Orchestration

### Event source
- historical dataset
- bars, quotes, or recorded normalized events

### Execution sink
- simulated execution engine

### Timing model
- simulated time

### Flow

```text
Historical Data Source
  → Backtest Loader
  → Normalize to Internal Events
  → Event Bus
  → Symbol/Rolling State Update
  → Strategy Evaluation
  → Risk Checks
  → Simulated Execution
  → Order/Fill Events
  → Portfolio State Update
  → Metrics Calculation
  → Persist backtest results
  → Frontend reads results
```

### Backtest mode responsibilities
- drive the engine forward in historical order
- maintain deterministic behavior
- simulate fills and slippage
- track PnL and portfolio evolution
- record result metrics

### Important design rule
The backtest engine should reuse the same state and strategy pipeline as live trading.

---

## 3. Replay Orchestration

### Event source
- previously recorded events from live or historical sessions

### Execution sink
- optional simulated execution or passive observation mode

### Timing model
- configurable:
  - real speed
  - accelerated
  - step-by-step

### Flow

```text
Recorded Event Stream
  → Replay Engine
  → Event Bus
  → State Update
  → Optional Strategy Evaluation
  → Optional Simulated Execution
  → Order/Portfolio Updates
  → Debugging and inspection output
```

### Replay mode responsibilities
- reproduce event sequences
- support debugging
- allow deterministic inspection of behavior
- compare decisions against historical runs

### Good replay features
- pause
- resume
- step one event at a time
- change playback speed

---

# How to Keep Orchestration Shared

The system should be structured so that:

## Shared pieces across all modes
- event bus
- state updates
- rolling windows
- indicator calculations
- strategy logic
- risk engine
- order state handling
- portfolio updates

## Mode-specific pieces
- event source
- execution sink
- timing control
- persistence/reporting differences

This can be expressed cleanly with abstractions like:

- `EventSource`
- `ExecutionSink`
- `Clock`
- `PersistenceAdapter`

Then:
- live mode plugs in live source + paper execution + wall clock
- backtest plugs in historical source + simulated execution + simulated clock
- replay plugs in recorded-event source + optional execution + replay clock

---

# Time-Based Rolling Window Design

This is one of the most important parts of the system.

The goal is to maintain a shared, generic rolling window abstraction that works across strategies and modes.

---

## Why Time-Based Instead of Count-Based?

A time-based window is often more appropriate for trading systems because:
- market activity varies during the day
- 100 events may represent very different time spans in quiet vs active periods
- many strategy concepts are naturally time-based
  - last 5 seconds
  - last 1 minute
  - last 20 minutes

A time-based window makes behavior more consistent across changing activity levels.

---

## Requirements for the Rolling Window

The rolling window should:
- store timestamped entries
- efficiently append new entries
- efficiently evict old entries
- expose current entries for calculations
- support multiple value types
- remain generic and reusable

Possible stored values:
- quotes
- trades
- bars
- spreads
- midprices
- returns
- volumes
- strategy-specific derived values

---

## Suggested Design

Create a generic structure conceptually like:

- window duration in milliseconds
- array/deque of timestamped entries
- push method
- evict method
- getItems method
- getLatest method

The abstraction should be generic enough to use as:

- rolling quotes window
- rolling trades window
- rolling spread window
- rolling midprice window

---

## Example Conceptual Interface

```ts
type TimedValue<T> = {
  ts: number;
  value: T;
};

class RollingTimeWindow<T> {
  constructor(private windowMs: number) {}

  push(item: TimedValue<T>): void {}
  evict(nowTs: number): void {}
  getItems(): TimedValue<T>[] {}
  getLatest(): TimedValue<T> | undefined {}
}
```

This is only conceptual. The final implementation can use arrays, ring-buffer-like logic, or a deque.

---

## Where the Rolling Window Lives

The rolling-window implementation belongs in the backend core state layer:

```text
src/core/state/
```

It should not live in:
- `services/` because it owns mutable state
- `types/` because it is not just a type
- `routes/` because it is not API logic

---

## How Symbol State Should Use It

Each tracked symbol should have a state object that owns one or more rolling windows.

Example conceptual symbol state:

- quotesWindow
- tradesWindow
- midpriceWindow
- spreadWindow
- latestQuote
- latestTrade
- latestBid
- latestAsk
- latestMid
- latestSpread
- indicator cache
- strategy-specific cached values

This allows strategies to query recent data without scanning the entire market history.

---

## Rolling Window Update Flow

When a new quote or trade arrives:

1. normalize event
2. compute derived values if needed
   - midprice
   - spread
   - imbalance
   - microprice
3. append value to relevant rolling windows
4. evict entries older than window duration
5. update latest symbol state
6. trigger strategy evaluation if needed

This keeps rolling state current in real time.

---

## What Should Be Stored Per Symbol

A practical initial symbol state may include:

### Current/latest values
- latest bid
- latest ask
- latest bid size
- latest ask size
- latest trade price
- latest trade size
- latest midprice
- latest spread
- latest timestamp

### Rolling windows
- recent quotes
- recent trades
- recent midprices
- recent spreads
- recent returns
- recent short-term bars if aggregated

### Derived metrics
- average spread over window
- rolling volatility
- short EMA
- long EMA
- z-score for strategy-specific spread
- quote update frequency
- trade count over window

---

## How to Compute Values with the Rolling Window

Some calculations can use the rolling window directly.
Others should maintain derived caches for efficiency.

### Can be derived from the window
- last N seconds of midprices
- recent spread history
- recent trade sizes
- quote count in last X seconds

### Can be cached incrementally
- EMA
- rolling mean
- rolling sum
- cumulative volume over current window
- simple statistics updated alongside pushes/evictions

For a simple initial implementation, direct recalculation over the current window is acceptable if window sizes and symbol counts are small.
Later, optimize bottlenecks only if needed.

---

## Suggested Simplicity-First Approach

Because the project should start simple:

- use a generic time-based rolling window
- store timestamped values
- use standard arrays/deques initially
- evict on every push
- recalculate small-window stats on demand at first
- optimize only when necessary

This is often the best balance between:
- clean architecture
- correctness
- implementation speed
- future extensibility

---

# Strategy Design

Each strategy should be modular and pluggable.

A strategy should:
- be instantiated with configuration parameters
- consume normalized symbol/portfolio state
- use rolling windows and indicators
- emit signals or order intents

A strategy should not:
- open WebSocket connections
- call Alpaca directly
- write directly to DB
- own unrelated orchestration logic

---

## Example Strategy Types

### **Pairs Trading**
- **Uses:**
  - two related instruments
  - spread or residual series
  - rolling mean/std
  - z-score thresholds
  - hedge ratio configuration

- **Typical logic:**
  - estimate the relationship between two instruments
  - compute the spread or residual between them
  - compare the current spread to its rolling mean and standard deviation
  - enter when deviation is large enough
  - exit when the spread reverts toward normal

- **What to parameterize:**
  - pair selection
  - rolling-window duration
  - hedge ratio method
    - fixed ratio
    - rolling regression
    - externally defined ratio
  - z-score entry threshold
  - z-score exit threshold
  - max holding time
  - stop-loss level
  - position sizing logic
  - cooldown period after exit
  - data frequency or aggregation interval

- **Why it fits the platform:**
  - uses rolling windows heavily
  - works well in backtest, replay, and live paper trading
  - easy to visualize in the frontend with spread, mean, and z-score charts

---

### **Arbitrage**
- **Uses:**
  - cross-instrument pricing relationships
  - spread/relationship validation
  - execution coordination rules

- **Typical logic:**
  - compare prices of instruments that should maintain a pricing relationship
  - detect temporary dislocations
  - enter positions designed to profit when prices converge back to fair relationship
  - manage execution carefully because the opportunity may disappear quickly

- **What to parameterize:**
  - instruments involved
  - fair-value relationship model
  - minimum spread threshold
  - execution sequencing rules
  - slippage assumptions
  - timeout before cancel/exit
  - max exposure
  - transaction-cost assumptions
  - aggregation interval or event type used

- **Why it fits the platform:**
  - reinforces event-driven execution logic
  - highlights the importance of latency and execution coordination
  - useful for replay and simulated execution experiments

---

### **Avellaneda-Stoikov Inventory-Aware Market Making**
- **Uses:**
  - midprice
  - volatility estimate
  - inventory level
  - risk aversion
  - market order arrival assumptions
  - reservation price and optimal spread calculations

- **Typical logic:**
  - continuously quote both bid and ask around a dynamically adjusted fair value
  - shift quotes depending on current inventory so the strategy reduces inventory risk
  - widen or narrow spreads depending on volatility, market conditions, and model parameters
  - try to earn spread capture while controlling inventory buildup

- **Core idea:**
  - instead of only predicting direction, the strategy manages two-sided quoting
  - the model computes a **reservation price** that shifts away from the observed midprice when inventory becomes too long or too short
  - it then computes an **optimal spread** based on volatility, risk aversion, time horizon, and fill assumptions
  - quotes are posted around that reservation price

- **Typical model components:**
  - current midprice
  - current inventory
  - short-term volatility estimate
  - time remaining in trading horizon
  - arrival-rate sensitivity or liquidity parameter
  - risk-aversion coefficient

- **What to parameterize:**
  - symbol or instrument universe
  - quote update frequency
  - inventory limit
  - target inventory
  - risk-aversion coefficient
  - volatility lookback window
  - trading horizon length
  - minimum quote spread
  - maximum quote spread
  - order size per quote
  - max total notional exposure
  - reservation price formula options
  - spread calculation formula options
  - inventory skew strength
  - quote refresh interval
  - cancel/replace threshold
  - stale quote timeout
  - fill handling rules
  - session trading hours
  - kill-switch thresholds for extreme volatility or inventory imbalance

- **Important derived values to track:**
  - midprice
  - microprice
  - short-term realized volatility
  - current inventory
  - current reservation price
  - current optimal bid/ask quotes
  - quoted spread
  - fill rate
  - inventory drift over time
  - mark-to-market PnL
  - realized spread capture

- **Why it fits the platform:**
  - very strong example of event-driven trading architecture
  - naturally uses rolling windows and in-memory state
  - requires real-time recalculation of quotes as events arrive
  - highlights the importance of separating market data, state, strategy logic, risk, and execution
  - gives a more realistic view of HFT-style system design than slower directional strategies

- **Frontend visualization ideas:**
  - current inventory over time
  - reservation price vs midprice
  - current bid/ask quotes
  - realized spread capture
  - quote update frequency
  - fill events and inventory changes

- **Notes on implementation:**
  - this strategy is much more sensitive to event timing and state updates than slower strategies
  - for a simple initial version, it can run on top-of-book quote updates only
  - later versions could incorporate order book imbalance, queue position estimates, and more advanced fill models

---

### **Neural Network Strategy Based on Technical Indicators**
- **Uses:**
  - derived indicator features instead of HFT-style microstructure signals
  - indicators such as SMA, EMA, ATR, RSI, MACD, Bollinger Bands, returns, and volume-based features
  - supervised learning to predict future return, direction, or regime

- **Typical logic:**
  - compute a set of technical indicators over historical price data
  - feed those indicators into a neural network model
  - train the model to predict a target such as:
    - next-period return
    - up/down direction
    - probability of favorable move
    - volatility regime
  - convert model output into trading decisions using configurable thresholds

- **Core idea:**
  - unlike the HFT-oriented strategies, this is more of a predictive modeling pipeline
  - it relies on feature engineering, model training, validation, and tuning
  - it is better suited to slower strategies based on bars rather than raw tick-by-tick execution
  - it still fits the platform because it can plug into the same backtest, replay, and portfolio framework

- **What to parameterize:**
  - symbol universe
  - bar timeframe
    - 1 minute
    - 5 minute
    - 1 hour
    - daily
  - prediction target
    - next return
    - next direction
    - multi-class regime
  - prediction horizon
  - training window length
  - validation/test split
  - retraining frequency
  - input feature set
  - neural network depth
  - hidden layer size
  - activation functions
  - dropout rate
  - learning rate
  - batch size
  - number of epochs
  - optimizer type
  - output threshold for entering trades
  - confidence threshold
  - stop-loss and take-profit settings
  - max position size
  - cooldown after signal

- **Indicators/features to support:**
  - SMA with configurable periods
  - EMA with configurable periods
  - ATR with configurable periods
  - RSI
  - MACD
  - Bollinger Bands
  - rolling volatility
  - rolling returns
  - volume change
  - price relative to moving averages
  - momentum over multiple horizons

- **How to handle “finding the best values” for indicators:**
  - treat indicator periods as hyperparameters
  - define a search space for things like:
    - SMA periods
    - EMA periods
    - ATR periods
    - RSI lookback
    - Bollinger window and band width
  - run systematic optimization during training/backtesting
  - compare candidate parameter sets using validation metrics
  - keep the best-performing feature configuration
  - then train the final neural network on the selected features/periods

- **Ways to optimize indicator/model settings:**
  - grid search
  - random search
  - Bayesian optimization later if needed
  - walk-forward validation to reduce overfitting
  - separate training, validation, and test periods

- **Important derived values to track:**
  - selected indicator parameters
  - current feature vector
  - model prediction
  - prediction confidence
  - training/validation metrics
  - feature importance approximations if available
  - live trade decisions generated from model output
  - performance by retraining period

- **Why it fits the platform:**
  - adds a very different class of strategy from HFT-style execution algorithms
  - shows that the platform can support both event-driven trading logic and ML-driven research workflows
  - works especially well in backtesting and replay
  - valuable for demonstrating modular strategy support and experimentation tooling

- **How it differs from the high-frequency strategies:**
  - relies more on historical feature engineering than ultra-low-latency event reaction
  - usually operates on bars rather than quote-by-quote market microstructure
  - focuses more on predictive modeling and parameter tuning
  - places more importance on training pipeline, validation, and overfitting control than execution speed alone

- **Frontend visualization ideas:**
  - selected indicators and their chosen periods
  - model predictions vs actual outcomes
  - training/validation loss
  - strategy equity curve
  - feature values at signal times
  - parameter search results
  - confusion matrix or directional accuracy metrics for classification-based models

- **Notes on implementation:**
  - this strategy should likely have a separate training workflow from live execution workflow
  - training can occur offline, while live trading only loads the trained model and computes current features
  - to keep architecture clean, the model-training pipeline can be treated as a research module that outputs a deployable strategy configuration and trained weights
---

## Strategy Configuration

Strategies should support configurable parameters such as:
- rolling-window duration
- signal thresholds
- stop-loss limits
- max position size
- instrument list
- aggregation interval
- entry and exit rules

This supports frontend-driven experimentation and backtesting.

---

# Suggested Frontend Design

The frontend should act as a control panel and visualization layer for the backend engine.

## Key frontend pages

### Dashboard
Shows:
- current strategy status
- live PnL
- open positions
- current market snapshots
- system health

### Strategy Management
Allows:
- selecting strategy type
- configuring parameters
- starting/stopping runs
- viewing active strategy list

### Portfolio View
Shows:
- positions
- open orders
- fills
- historical portfolio curve
- exposure metrics

### Backtest View
Allows:
- selecting strategy + parameter set
- choosing date range
- running backtest
- reviewing output metrics and charts

### Replay View
Allows:
- choosing recorded session
- controlling playback speed
- stepping through event flow
- observing strategy and state changes

---

## Frontend Responsibilities

The frontend should:
- call backend APIs
- display snapshots and history
- show strategy state and metrics
- allow configuration and control
- optionally consume live backend updates

The frontend should not:
- compute core strategy decisions
- maintain authoritative trading state
- directly call Alpaca

---

# Suggested Database Responsibilities

The database can store:

- instruments/equities metadata
- strategy definitions
- strategy runs
- backtest runs
- replay sessions
- order history
- fills
- portfolio snapshots
- performance metrics
- user-specific saved configurations

The DB is especially useful for:
- analytics
- restoring sessions
- chart history
- comparing runs
- auditing what happened

---

# High-Level Build Plan

A good implementation order:

## Phase 1
- create backend folder structure
- create frontend folder structure
- define core shared types
- create basic Express API
- create Alpaca adapters
- create generic rolling time window
- create symbol state manager

## Phase 2
- build event bus/orchestrator
- wire live market data into state updates
- add simple paper execution flow
- expose portfolio/strategy APIs to frontend

## Phase 3
- implement first strategy
- implement risk checks
- implement portfolio/order state tracking
- persist key snapshots/results

## Phase 4
- build backtest mode using shared engine
- build replay mode using recorded events
- build frontend backtest/replay pages

## Phase 5
- improve metrics
- optimize bottlenecks
- add additional strategies
- add richer live monitoring and controls

---

# Final Goal Statement

The final platform should be:

> A scalable, event-driven algorithmic trading system that mirrors real-world HFT architecture while remaining practical for learning, experimentation, and portfolio-quality software engineering.

It should demonstrate:
- clean systems design
- modular strategy architecture
- reusable orchestration across modes
- in-memory low-latency state handling
- strong frontend/backend separation
- a professional engineering approach to algorithmic trading infrastructure
