# Avellaneda-Stoikov Inventory-Aware Market Making

## Overview

The `AvellanedaStoikovStrategy` (`src/strategies/marketMaking/avellanedaStoikovStrategy.ts`) is an inventory-aware market-making strategy that continuously quotes a bid and an ask around a **reservation price** computed from the current mid, the signed inventory, and a short-term volatility estimate. The model is the canonical formulation from Avellaneda & Stoikov (2008), *"High-frequency trading in a limit order book"*.

It plugs into the standard `IStrategy` interface (`evaluate(context) → StrategySignal | null`) and uses a small orchestrator extension (see [Two-sided quoting integration](#two-sided-quoting-integration)) to emit paired limit orders without disturbing existing single-direction strategies.

```
mid price + inventory + σ
        ↓
reservation price r = s − (q − q_target) · γ · σ² · (T − t)
        ↓
optimal half-spread δ = ½ · ( γ · σ² · (T − t) + (2/γ) · ln(1 + γ/κ) )
        ↓
        bid = r − δ                 ask = r + δ
        ↓ snap to tick, clamp [minHalfSpread, maxHalfSpread], apply inventory caps
        ↓
StrategySignal { direction: "flat", meta.kind: "maker_quotes", meta.makerQuotes: [...] }
        ↓ Orchestrator._onMakerQuoteSignal
ORDER_INTENT_CREATED × N  (one LIMIT intent per leg)
```

---

## Model

### Notation

| Symbol | Description |
| --- | --- |
| `s` | latest mid price (from `SymbolState.latestMid`) |
| `q` | signed inventory in shares (`portfolioState.getPosition(symbol).qty`) |
| `q_target` | target inventory (typically 0) |
| `γ` (gamma) | risk aversion coefficient — larger = wider, more inventory-skewed quotes |
| `σ` (sigma) | short-term realized volatility estimate of mid log-returns |
| `T − t` | time-to-close as a fraction of the configured horizon, in `[minHorizonFraction, 1]` |
| `κ` (kappa) | order-arrival intensity proxy (higher κ = tighter optimal spread) |

### Formulas

**Reservation price.** A fair-value estimate that *shifts away from the mid in the direction that reduces inventory risk*:

```
r = s − (q − q_target) · γ · σ² · (T − t)
```

- Long inventory (`q > 0`) ⇒ `r < s`, pushing the ask closer to the market (more attractive to fill) and the bid farther away (less attractive). Net effect: the strategy preferentially sells off long inventory.
- Short inventory (`q < 0`) ⇒ `r > s`, symmetric effect on the bid side.

**Optimal half-spread.** Two-term decomposition:

```
δ = ½ · ( γ · σ² · (T − t)  +  (2/γ) · ln(1 + γ/κ) )
```

- The first term scales with risk × variance × horizon and shrinks to 0 as `T − t → 0`.
- The second term is a horizon-independent component representing the cost of providing liquidity at intensity `κ`. It does **not** vanish at end-of-horizon.

The realized half-spread is then clamped:

```
δ_used = clamp(δ, minHalfSpread, maxHalfSpread)
```

and the candidate quotes are snapped to `tickSize`:

```
bid = floor((r − δ_used) / tickSize) · tickSize
ask = ceil ((r + δ_used) / tickSize) · tickSize
```

with `ask − bid ≥ tickSize` enforced post-snap.

### Volatility estimation

Two estimators are available via `volEstimator`:

- `"stddev_returns"` (default): sample std-dev of the most recent `volWindowSize + 1` mid log-returns from the strategy's own rolling window.
- `"ewma_returns"`: exponentially weighted variance of log returns with decay `volEwmaLambda` (default 0.94).

Both estimators output **per-bar** σ in return units (same scale as `ln(s_t / s_{t-1})`), not annualized. σ is clamped to `[sigmaFloor, sigmaCap]` before use.

### Time-to-close

`T − t` is computed as `(horizonMs − (now − startedAtMs)) / horizonMs`, clamped to `[minHorizonFraction, 1]` when `clampHorizon` is true. The clamp prevents the spread term from collapsing to zero near end-of-day, which would otherwise produce trivially tight quotes regardless of vol.

### Inventory caps and kill-switch

| Condition | Effect |
| --- | --- |
| `q ≥ inventoryLimit` | Suppress **buy** side (no new long exposure). `meta.suppression = "inventory_cap_long"`. |
| `q ≤ −inventoryLimit` | Suppress **sell** side. `meta.suppression = "inventory_cap_short"`. |
| `σ ≥ killSwitchSigma` | Suppress **both** sides. `meta.suppression = "kill_switch"`. |
| `|q| ≥ inventoryLimit × killSwitchInventoryMult` | Suppress **both** sides. `meta.suppression = "kill_switch"`. |

When both sides are suppressed, the strategy still emits a `StrategySignal` with an empty `makerQuotes` array so observability layers (UI, logs, metrics) can track kill-switch transitions.

### No lookahead

The strategy reads only what is already present in `EvaluationContext` at the moment `evaluate()` is invoked: the latest mid in `SymbolState` (pushed by the orchestrator from the current event), and the strategy's own rolling window of prior mids accumulated from earlier `evaluate()` calls. It never peeks at future bars or future fills. Under the platform's bar-driven backtest, this means quotes posted on bar `N`'s close can only fill at bar `N+1`'s open — see [Backtest limitations](#backtest-limitations).

---

## Parameters

All parameters live on `AvellanedaStoikovConfig` (`avellanedaStoikovTypes.ts`). Required fields per instance are `symbol` and the `id`; `createAvellanedaStoikovConfig()` fills everything else from defaults.

### Core model
| Field | Default | Notes |
| --- | --- | --- |
| `gamma` | 0.5 | Risk aversion (γ). Must be > 0. |
| `kappa` | 1.5 | Order-arrival intensity proxy (κ). Must be > 0. |
| `horizonMs` | 23 400 000 | One US-equity trading session (6.5 h). |
| `clampHorizon` | true | If true, `(T − t)/horizonMs ≥ minHorizonFraction`. |
| `minHorizonFraction` | 0.05 | Floor for (T − t) fraction when clamping. |
| `inventoryTarget` | 0 | Reservation skew is computed relative to this. |

### Volatility
| Field | Default | Notes |
| --- | --- | --- |
| `volEstimator` | `"stddev_returns"` | or `"ewma_returns"`. |
| `volWindowSize` | 30 | # most-recent mid observations used for σ. |
| `volEwmaLambda` | 0.94 | Decay for EWMA estimator. |
| `sigmaFloor` | 1e-5 | Lower clamp on σ. |
| `sigmaCap` | 0.05 | Upper clamp on σ. |

### Quoting / sizing
| Field | Default | Notes |
| --- | --- | --- |
| `baseOrderQty` | 10 | Quantity per side. |
| `maxQuoteQty` | 20 | Hard cap on per-side qty. |
| `minHalfSpread` | 0.01 | Floor on δ (≥ 0). |
| `maxHalfSpread` | 1.00 | Cap on δ. |
| `tickSize` | 0.01 | Bid snapped down; ask snapped up. |
| `quoteRefreshMs` | 1 000 | Min interval between successive quote emissions. |

### Risk safeguards
| Field | Default | Notes |
| --- | --- | --- |
| `inventoryLimit` | 200 | Hard cap on absolute inventory. |
| `killSwitchSigma` | 0.10 | Halt when σ ≥ this. |
| `killSwitchInventoryMult` | 1.5 | Halt when `|q| ≥ inventoryLimit × this`. |
| `minObservations` | 10 | Minimum mid samples before quoting. |

---

## Named presets

`createAvellanedaStoikovConfig(symbol, preset, overrides)` layers a named preset on top of the defaults. All three presets are validated against the same constraints:

### Conservative
- `gamma: 1.5`, `kappa: 0.8`
- `baseOrderQty: 5`, `maxQuoteQty: 10`, `inventoryLimit: 100`
- `minHalfSpread: 0.05` (5¢ floor → 10¢ minimum quoted spread), `maxHalfSpread: 0.50`
- `quoteRefreshMs: 2_000`, `killSwitchSigma: 0.05`, `killSwitchInventoryMult: 1.2`
- `volWindowSize: 60`, `minObservations: 30`

Best for paper-trading and low-toxicity environments. Slower, wider, less inventory tolerance.

### Balanced (default)
- The defaults above. A reasonable starting point for liquid US equities on minute bars.

### Aggressive
- `gamma: 0.2`, `kappa: 3.0`
- `baseOrderQty: 25`, `maxQuoteQty: 50`, `inventoryLimit: 500`
- `minHalfSpread: 0.01`, `maxHalfSpread: 0.25`
- `quoteRefreshMs: 500`, `killSwitchSigma: 0.20`, `killSwitchInventoryMult: 2.0`
- `volWindowSize: 20`, `minObservations: 10`

Tighter spreads and faster refresh, higher fill rate, more sensitive to adverse selection. **Do not run aggressive presets live without thorough backtest validation.**

---

## Usage

### Instantiation

```ts
import {
  AvellanedaStoikovStrategy,
  createAvellanedaStoikovConfig,
} from "./strategies/marketMaking";

const config = createAvellanedaStoikovConfig("AAPL", "balanced", {
  // optional overrides
  baseOrderQty: 15,
  maxHalfSpread: 0.25,
});
const strategy = new AvellanedaStoikovStrategy(config);

orchestrator.registerStrategy(strategy);
```

### Backtesting

The strategy is mode-agnostic. To backtest:

1. Construct an `Orchestrator` in `"backtest"` mode with a `SimulatedExecutionSink`.
2. Register the AS strategy with `orchestrator.registerStrategy(strategy)`.
3. Feed bar events through the bus (see `src/runtime/backtest.ts`).
4. Inspect `strategy.getInternalSnapshot()` and the resulting `ORDER_*` events to verify behaviour.

Recommended initial run: `balanced` preset, single liquid symbol, 1-minute bars over one session, `slippageBps: 0` in the simulator to isolate model behaviour from execution drift.

---

## Two-sided quoting integration

The base `IStrategy` interface assumes a single directional signal per `evaluate()`. To preserve that contract while supporting two-sided quoting, the AS strategy emits one `StrategySignal` with:

```ts
signal.direction = "flat";
signal.meta = {
  kind: "maker_quotes",
  makerQuotes: [
    { side: "buy",  price: 99.95,  qty: 10 },
    { side: "sell", price: 100.05, qty: 10 },
  ],
  timeInForce: "day",
  // diagnostics:
  reservationPrice, halfSpread, sigma, inventory, midPrice,
};
```

The Orchestrator detects `signal.meta.kind === "maker_quotes"` in `_onStrategySignal` and routes the signal through `_onMakerQuoteSignal`, which emits **one `ORDER_INTENT_CREATED` per leg** as a LIMIT order. Top-level `signal.qty` and `signal.direction` are ignored on the maker-quote path. Existing single-direction strategies are completely unaffected.

This is the *minimum* engine change required to make true two-sided quoting expressible. The strategy never bypasses the existing risk and execution pipeline — each leg flows through `RiskEngine.check()` and `ExecutionEngine.submit()` exactly like any other intent.

---

## Backtest limitations

The simulated execution path now runs each queued intent through the configurable fill model in `src/core/execution/fillModel.ts` (`evaluateFill`). That closes the largest historical gap for maker-style strategies — limit orders are now gated against a simulated touch price — but several modeling caveats remain.

### What the new fill model gives you

1. **Limit-price gating.** `evaluateFill` computes a simulated touch price from the bar reference (open / close / vwap, configurable), adds the configured `halfSpreadBps`, then applies `slippageBps` adversely. A limit `buy` only fills if that touch price is ≤ `intent.limitPrice`; a limit `sell` only fills if it is ≥ `intent.limitPrice`. Quotes that do not cross the simulated touch are emitted as `ORDER_REJECTED` with reason `"Limit price not crossed by reference price"`. End-to-end coverage lives in `src/tests/core/backtestMakerQuotesFillModel.test.ts`.
2. **Volume participation cap.** Per-leg fill quantity is capped at `volumeParticipationCap * bar.volume`; the residual either partial-fills or rejects depending on `allowPartialFills`. Zero-volume (halt) bars reject all queued intents.
3. **Cancel by broker order id.** `SimulatedExecutionSink.cancelOrder()` removes a queued intent before it can fill, so a strategy that tracks its own resting order ids can implement cancel-replace.

### Remaining caveats

1. **Touch model uses bar reference, not bar high/low.** The simulated touch price is `referencePrice ± halfSpread ± slippage`, *not* the bar's actual high (for buys) or low (for sells). A quote inside the bar's range may still be rejected if the chosen reference + spread does not reach it, and conversely a quote outside the bar's range can fill if `halfSpreadBps`/`slippageBps` push the touch that far. Tune `referencePrice`, `halfSpreadBps`, and `slippageBps` to bracket the bar's range if you need a stricter crossed-tape approximation.
2. **No queue-position model.** When a limit price *does* cross, the entire residual (subject to participation cap) fills. A real maker queue would fill only the portion of size that survived time priority at that price. The simulator has no queue-priority state.
3. **No automatic cancel-on-refresh.** When the strategy emits a fresh quote (after `quoteRefreshMs`), prior resting intents are not auto-canceled — `SimulatedExecutionSink` only cancels via explicit `cancelOrder(brokerOrderId)`. The strategy itself does not currently issue cancels for its own prior quotes, so until that wiring lands, prefer `quoteRefreshMs ≥ bar duration` or call `cancelOrder()` from the harness around each new quote pair.
4. **Both legs can fill on the same bar.** If the simulated touch sits between the bid and ask of a refreshed quote pair, both legs may fill against the same bar — impossible at a real venue, where only one side of a posted pair can be hit at any one instant.
5. **No adverse-selection metric.** `computeMetrics` does not yet track fill-side vs subsequent mid drift, so an aggressively-priced spread that always crosses will look profitable without the toxicity penalty a real venue would impose.

### What would still need work

- Replace the reference-based touch with a true `[bar.low, bar.high]` "crossed" rule (or per-trade tape) for tighter gating.
- Queue-position state: time-priority + partial-fill across ticks at the same price.
- Strategy-driven cancel-replace: have `AvellanedaStoikovStrategy` track its own resting intent ids and emit `cancelOrder()` for the previous pair when a new quote is emitted.
- Adverse-selection / mid-drift metric in `computeMetrics` so toxicity is reflected in P&L attribution.

The strategy and its unit tests are written so the strategy logic is correct *independent* of how the simulator chooses to fill the resulting orders. The integration test for the maker-quote → fill-model path lives in `src/tests/core/backtestMakerQuotesFillModel.test.ts` — interpret backtest results with the remaining caveats above in mind.

---

## Diagnostics

`strategy.getInternalSnapshot()` returns a small object useful for tests and UI:

```ts
{
  midObservations: number;
  lastSigma: number | null;
  lastReservationPrice: number | null;
  lastHalfSpread: number | null;
  quoteEmissions: number;
  killSwitchActivations: number;
}
```

When `BACKTEST_DEBUG=1`, `strategy.printDebugCounters()` prints a signal funnel breakdown (eval calls / insufficient obs / cooldown suppressed / kill-switched / two-sided / one-sided / no-quote) at the end of a run, matching the pattern used by `PairsStrategy`.

---

## References

- M. Avellaneda & S. Stoikov, *"High-frequency trading in a limit order book"*, Quantitative Finance 8(3), 217–224, 2008.
- See also `strategies.md` (repo root) for the platform's market-making strategy brief.
