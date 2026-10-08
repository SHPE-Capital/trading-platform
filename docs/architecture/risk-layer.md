# Risk Layer — Implementation Guide

## Overview

The `RiskEngine` (`core/risk/riskEngine.ts`) validates every `OrderIntent` before it reaches the execution layer. Checks run sequentially; the first failure short-circuits and returns a `RiskCheckResult { passed: false }`. The orchestrator then publishes a `RISK_REJECTED` event.

```
OrderIntent
    ↓
RiskEngine.check(intent, portfolioSnapshot)
    ↓ runs checks in array order, short-circuits on first failure
    ├─ [1] KILL_SWITCH            — blocks everything when active
    ├─ [2] ORDER_COOLDOWN         — per-strategy cooldown enforcement
    ├─ [3] MAX_POSITION_SIZE      — per-symbol notional cap
    ├─ [4] MAX_NOTIONAL_EXPOSURE  — portfolio-wide notional cap
    ├─ [5] SHORT_SELLING_DISALLOWED — naked short guard
    ├─ [6] CASH_RESERVE           — [STUB] minimum cash buffer
    ├─ [7] INTRADAY_DRAWDOWN      — [STUB] daily loss circuit breaker
    └─ [8] CONCENTRATION_LIMIT    — [STUB] single-symbol concentration cap
    ↓
RiskCheckResult { passed, intent, failedCheck?, reason?, ts }
```

---

## Existing Checks (implemented)

### `[1] KILL_SWITCH`
- **failedCheck:** `"KILL_SWITCH"`
- **Logic:** If `config.killSwitchActive === true`, block all orders immediately.
- **Control:** `riskEngine.setKillSwitch(true/false)` — also exposed via the strategies API.

### `[2] ORDER_COOLDOWN`
- **failedCheck:** `"ORDER_COOLDOWN"`
- **Logic:** Tracks `lastOrderTs` per strategy. If `now - lastOrderTs < orderCooldownMs`, reject.
- **Config:** `orderCooldownMs` (default: `5000ms` from env; `0` in backtest mode).
- **Edge case:** First order from a strategy always passes (no `lastOrderTs` entry).

### `[3] MAX_POSITION_SIZE`
- **failedCheck:** `"MAX_POSITION_SIZE"`
- **Logic:** `newNotional = |newQty × estimatedPrice|`. Reject if `newNotional > maxPositionSizeUsd`.
- **Price fallback:** Uses `existingPosition.currentPrice ?? intent.limitPrice ?? 0`. Returns `null` (passes) if no price available.
- **Config:** `maxPositionSizeUsd` (default: `$10,000` from env).

### `[4] MAX_NOTIONAL_EXPOSURE`
- **failedCheck:** `"MAX_NOTIONAL_EXPOSURE"`
- **Logic:** Sums `|qty × price|` across all positions (including new intent). Reject if total exceeds limit.
- **Config:** `maxNotionalExposureUsd` (default: `$50,000` from env).

### `[5] SHORT_SELLING_DISALLOWED`
- **failedCheck:** `"SHORT_SELLING_DISALLOWED"`
- **Logic:** If `allowShortSelling === false` and `intent.side === "sell"` and `intent.qty > heldQty`, reject.
- **Config:** `allowShortSelling` (default: `false` live; `true` in backtest for pairs strategy).

---

## New Check Stubs (to implement)

### `[6] CASH_RESERVE` — `_checkCashReserve()`

Prevents orders from consuming the minimum cash buffer.

**Implementation:**

```typescript
private _checkCashReserve(intent: OrderIntent, portfolio: PortfolioSnapshot) {
  const existingPrice = portfolio.positions.find(p => p.symbol === intent.symbol)?.currentPrice;
  const estimatedPrice = intent.limitPrice ?? existingPrice ?? 0;
  if (estimatedPrice === 0) return null;  // skip if no price

  const estimatedCost = intent.qty * estimatedPrice;
  const reserveFloor = portfolio.cash * (this.config.cashReservePct ?? 0);
  const availableCash = portfolio.cash - reserveFloor;

  if (estimatedCost > availableCash) {
    return {
      failedCheck: "CASH_RESERVE",
      reason: `Order cost $${estimatedCost.toFixed(2)} exceeds available cash $${availableCash.toFixed(2)} (${((this.config.cashReservePct ?? 0) * 100).toFixed(0)}% reserve floor)`,
    };
  }
  return null;
}
```

**Config:** `cashReservePct` (default: `0.05` = 5% buffer always held in reserve).

**Note:** Once `CapitalReservationManager` is wired into the orchestrator, this check becomes the in-engine enforcement of the same invariant. Both should coexist: OMS reserves before the check runs, so `portfolio.cash` here should reflect post-reservation available cash.

---

### `[7] INTRADAY_DRAWDOWN` — `_checkIntradayDrawdown()`

Engages the kill switch if the portfolio has lost too much value since market open.

**Implementation:**

```typescript
// Add private field:
private _sessionStartEquity: number | null = null;

private _checkIntradayDrawdown(_intent: OrderIntent, portfolio: PortfolioSnapshot) {
  const limit = this.config.maxIntradayDrawdownPct;
  if (!limit) return null;

  // Initialize on first check of the session
  if (this._sessionStartEquity === null) {
    this._sessionStartEquity = portfolio.equity;
    return null;
  }

  const drawdownPct = (this._sessionStartEquity - portfolio.equity) / this._sessionStartEquity;
  if (drawdownPct >= limit) {
    this.setKillSwitch(true);
    return {
      failedCheck: "INTRADAY_DRAWDOWN",
      reason: `Intraday drawdown ${(drawdownPct * 100).toFixed(2)}% exceeds limit of ${(limit * 100).toFixed(0)}% — kill switch engaged`,
    };
  }
  return null;
}
```

**Config:** `maxIntradayDrawdownPct` (default: `0.05` = 5%).

**Session reset:** Call `riskEngine.resetSession()` (add this method) on `ENGINE_STARTED` event to clear `_sessionStartEquity = null` for a fresh trading session.

---

### `[8] CONCENTRATION_LIMIT` — `_checkConcentration()`

Prevents any single symbol from becoming too large a fraction of portfolio equity.

**Implementation:**

```typescript
private _checkConcentration(intent: OrderIntent, portfolio: PortfolioSnapshot) {
  const limit = this.config.maxConcentrationPct;
  if (!limit || portfolio.equity <= 0) return null;

  const existingPos = portfolio.positions.find(p => p.symbol === intent.symbol);
  const estimatedPrice = intent.limitPrice ?? existingPos?.currentPrice ?? 0;
  if (estimatedPrice === 0) return null;

  const existingQty = existingPos?.qty ?? 0;
  const qtyDelta = intent.side === "buy" ? intent.qty : -intent.qty;
  const newSymbolValue = Math.abs((existingQty + qtyDelta) * estimatedPrice);
  const concentrationPct = newSymbolValue / portfolio.equity;

  if (concentrationPct > limit) {
    return {
      failedCheck: "CONCENTRATION_LIMIT",
      reason: `${intent.symbol} would be ${(concentrationPct * 100).toFixed(1)}% of portfolio equity, exceeds ${(limit * 100).toFixed(0)}% limit`,
    };
  }
  return null;
}
```

**Config:** `maxConcentrationPct` (default: `0.30` = 30%).

---

## `RiskConfig` Full Reference

| Field | Type | Default | Description |
|---|---|---|---|
| `maxPositionSizeUsd` | `number` | `$10,000` (env) | Max notional per symbol |
| `maxNotionalExposureUsd` | `number` | `$50,000` (env) | Max total portfolio notional |
| `orderCooldownMs` | `number` | `5,000ms` (env) | Per-strategy cooldown between orders |
| `staleQuoteThresholdMs` | `number` | `10,000ms` | Max age of a quote before it's considered stale (not yet enforced in checks) |
| `allowShortSelling` | `boolean` | `false` | Whether naked shorts are allowed |
| `killSwitchActive` | `boolean` | `false` | Blocks all orders when true |
| `maxIntradayDrawdownPct` | `number?` | `0.05` | Daily loss limit before kill switch engages |
| `maxConcentrationPct` | `number?` | `0.30` | Max fraction of equity in any single symbol |
| `cashReservePct` | `number?` | `0.05` | Minimum cash fraction always kept in reserve |

---

## Testing Guidance

### Unit test setup

```typescript
const makePortfolio = (overrides?: Partial<PortfolioSnapshot>): PortfolioSnapshot => ({
  id: "test", ts: Date.now(), isoTs: "",
  equity: 100_000,
  cash: 50_000,
  positions: [],
  totalReturn: 0, totalReturnPct: 0,
  realizedPnl: 0, unrealizedPnl: 0,
  ...overrides,
});

const makeIntent = (overrides?: Partial<OrderIntent>): OrderIntent => ({
  id: "intent-1", strategyId: "strat-1",
  symbol: "AAPL", side: "buy", qty: 10,
  orderType: "market", timeInForce: "ioc",
  limitPrice: 200, ts: Date.now(),
  ...overrides,
});
```

### Edge cases per new check

**`_checkCashReserve`**
- No limit price and no existing position price → should skip (return null)
- `cashReservePct: 0` → reserve floor is 0, all cash is available
- Exactly at the limit (`estimatedCost === availableCash`) → should pass

**`_checkIntradayDrawdown`**
- First call with no `_sessionStartEquity` → should pass and initialize
- Equity exactly at limit (`drawdownPct === maxIntradayDrawdownPct`) → should fail and engage kill switch
- Zero `_sessionStartEquity` (unlikely but possible) → guard against division by zero

**`_checkConcentration`**
- No existing position and no `limitPrice` → should skip (return null)
- Selling reduces concentration below limit → should pass (qtyDelta is negative)
- Zero portfolio equity → should skip to avoid division by zero
