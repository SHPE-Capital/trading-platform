# Position Sizing Layer — Implementation Guide

## Overview

The position sizing layer decouples **how much to trade** from **when to trade**. Strategies emit `StrategySignal` with a desired `qty`; in the future, the orchestrator will call a configured `IPositionSizer` to override or validate that quantity before building the `OrderIntent`.

```
StrategySignal (qty from strategy)
    ↓
Orchestrator._onStrategySignal()
    ↓
[TODO] IPositionSizer.computeQty(params)   ← replaces signal.qty
    ↓
OrderIntent { qty: computed }
    ↓
OMS → Risk → Execution
```

---

## `IPositionSizer` Interface — `core/sizing/IPositionSizer.ts`

```typescript
interface IPositionSizer {
  readonly type: SizerType;
  computeQty(params: PositionSizerParams): number;
}

interface PositionSizerParams {
  symbol: string;
  direction: SignalDirection;
  estimatedPrice: number;          // latest mid from symbolState
  portfolio: PortfolioStateManager;
  symbolState: SymbolStateManager;
  strategyConfig: BaseStrategyConfig;
}
```

**Contract:**
- Always returns a non-negative integer (floored).
- Returns `0` if sizing is not possible (zero price, insufficient data, etc.).
- Must not mutate `portfolio` or `symbolState`.

---

## Wiring into the Orchestrator

In `Orchestrator._onStrategySignal()` (see TODO comment, ~line 249):

```typescript
// 1. Inject a sizer map into the Orchestrator constructor:
constructor(
  // ...existing params
  private readonly positionSizers: Map<SizerType, IPositionSizer>,
) {}

// 2. Select the sizer from strategy config:
const sizerType = signal.strategyConfig?.sizerType ?? "fixed_notional";
const sizer = this.positionSizers.get(sizerType) ?? this.positionSizers.get("fixed_notional")!;

// 3. Call computeQty:
const symState = this.symbolState.get(signal.symbol);
const estimatedPrice = symState?.latestMid ?? 0;
const qty = estimatedPrice > 0
  ? sizer.computeQty({ symbol: signal.symbol, direction: signal.direction,
                       estimatedPrice, portfolio: this.portfolioState,
                       symbolState: this.symbolState, strategyConfig: signal.strategyConfig })
  : signal.qty;  // fallback to strategy-provided qty if no price

// 4. Build intent with computed qty:
const intent = { ...intentBase, qty };
```

---

## `FixedNotionalSizer` — `core/sizing/fixedNotionalSizer.ts`

**Status: Fully implemented.**

```
qty = floor(strategyConfig.maxPositionSizeUsd / estimatedPrice)
```

This is the exact logic extracted from `PairsStrategy._computeQty()`. Once wired into the orchestrator, the `_computeQty()` method in [pairsStrategy.ts](../src/strategies/pairs/pairsStrategy.ts) should be removed (see TODO comment there).

**Example:** `maxPositionSizeUsd = 10_000`, `estimatedPrice = 450.00` → `qty = 22`

---

## `VolatilityScaledSizer` — `core/sizing/volatilityScaledSizer.ts`

**Status: Scaffolded — returns 0.**

### Formula

```
realizedVol   = computeRealizedVolatility(midPrices)   // from services/indicators/volatility.ts
scaledNotional = min(maxNotionalUsd, baseNotionalUsd * (targetVol / realizedVol))
qty            = floor(scaledNotional / estimatedPrice)
```

### Implementation Steps

1. **Retrieve price history:** `params.symbolState.get(params.symbol)?.midPrices.getAll().map(e => e.value)`
2. **Compute realized vol:** `computeRealizedVolatility(prices)` from `@/services/indicators/volatility`. Returns annualized standard deviation of log returns. Returns `null` if fewer than 2 prices.
3. **Fallback:** If `realizedVol` is `null`, `0`, or `NaN`, fall back to `FixedNotionalSizer.computeQty(params)`.
4. **Scale:** `scaledNotional = Math.min(this.maxNotionalUsd, this.baseNotionalUsd * (this.targetVol / realizedVol))`
5. **Return:** `Math.floor(scaledNotional / params.estimatedPrice)`

### Constructor Parameters

```typescript
new VolatilityScaledSizer(
  targetVol: 0.15,        // 15% annualized target volatility
  baseNotionalUsd: 10_000, // base position size at target vol
  maxNotionalUsd: 25_000,  // hard cap regardless of vol ratio
)
```

### Expected Behavior

| Realized Vol | targetVol | Scale Factor | scaledNotional (base $10k) |
|---|---|---|---|
| 0.30 (high) | 0.15 | 0.5× | $5,000 |
| 0.15 (at target) | 0.15 | 1.0× | $10,000 |
| 0.08 (low) | 0.15 | 1.875× | $18,750 (capped at max) |

---

## `KellyFractionalSizer` — `core/sizing/kellyFractionalSizer.ts`

**Status: Scaffolded — returns 0.**

### Formula

```
winRate  = winning trades / total trades
odds     = avgWin / avgLoss
f*       = winRate - (1 - winRate) / odds       // full Kelly fraction
adjF     = f* * kellyFraction                   // apply half-Kelly (0.5) for safety
notional = min(maxNotionalUsd, adjF * equity)
qty      = floor(notional / estimatedPrice)
```

### Implementation Steps

1. **Retrieve closed trade history:** `PortfolioStateManager` will need a `getClosedTrades()` method returning `{ realizedPnl: number }[]`.
2. **Minimum history guard:** Return `0` if `closedTrades.length < this.minTrades` (default 10).
3. **Compute stats:**
   ```typescript
   const wins = closedTrades.filter(t => t.realizedPnl > 0);
   const losses = closedTrades.filter(t => t.realizedPnl < 0);
   const winRate = wins.length / closedTrades.length;
   const avgWin = wins.reduce((s, t) => s + t.realizedPnl, 0) / (wins.length || 1);
   const avgLoss = Math.abs(losses.reduce((s, t) => s + t.realizedPnl, 0)) / (losses.length || 1);
   ```
4. **Guard against zero losses:** Return `0` if `avgLoss === 0` (Kelly undefined).
5. **Compute Kelly fraction:** `f* = winRate - (1 - winRate) / (avgWin / avgLoss)`. Clip to `[0, 1]`.
6. **Scale and floor:**
   ```typescript
   const adjF = Math.max(0, fStar) * this.kellyFraction;
   const equity = params.portfolio.getSnapshot().equity;
   const notional = Math.min(this.maxNotionalUsd, adjF * equity);
   return Math.floor(notional / params.estimatedPrice);
   ```

### Constructor Parameters

```typescript
new KellyFractionalSizer(
  kellyFraction: 0.5,      // half-Kelly — standard recommendation
  maxNotionalUsd: 25_000,  // hard cap
  minTrades: 10,           // minimum history before using Kelly
)
```

### Why Half-Kelly?

Full Kelly maximizes long-run geometric growth but requires exact knowledge of edge and odds. In practice, both are estimated from noisy history, so full Kelly over-bets. Half-Kelly captures ~75% of the growth benefit with significantly lower drawdowns.

---

## Sizer Registry (runtime setup)

```typescript
// In runtime/live.ts or runtime/backtest.ts:
const positionSizers = new Map<SizerType, IPositionSizer>([
  ["fixed_notional",    new FixedNotionalSizer()],
  ["volatility_scaled", new VolatilityScaledSizer(0.15, 10_000, 25_000)],
  ["kelly_fractional",  new KellyFractionalSizer(0.5, 25_000, 10)],
]);

const orchestrator = new Orchestrator(
  eventBus, symbolState, portfolioState, orderState,
  riskEngine, executionEngine,
  positionSizers,  // new param
  mode,
);
```
