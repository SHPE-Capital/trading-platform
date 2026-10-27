# Position sizing

## What determines quantity today

Strategies emit `StrategySignal.qty`. The orchestrator converts that quantity
into order intents; there is currently no shared sizer registry overriding it.
Pairs trading computes its own quantities from strategy notional/price inputs;
the reversal strategies use fixed share quantities from their configurations.
Multi-leg intent construction also handles the counterpart quantity.

Sizing chooses a requested quantity. [Risk](risk-layer.md) and
[capital reservations](oms-layer.md) can reject it afterward; they are not a
promise that a requested position will be reached.

## Sizer modules and their current status

All paths below are under `backend/src/core/sizing/`.

| Module | Implementation | Integrated into orchestrator? |
|---|---|---|
| `IPositionSizer.ts` | Interface and `PositionSizerParams` contract | No |
| `fixedNotionalSizer.ts` | `floor(maxPositionSizeUsd / estimatedPrice)`, zero for non-positive price | No |
| `volatilityScaledSizer.ts` | Scaffold; logs a warning and returns zero | No |
| `kellyFractionalSizer.ts` | Scaffold; logs a warning and returns zero | No |

A `sizerType` field or an implemented helper alone does not activate shared
sizing. The active path is visible in `core/engine/orchestrator.ts` and each
strategy's signal construction.

## Extending sizing

Before adding a shared sizer, define whether it sizes an order increment or a
target position, how closes and multi-leg hedge quantities are handled, and
which historical observations are available at the decision time. Wire it
explicitly before intent risk checks and preserve each strategy's behavior or
bump its algorithm version when that behavior changes.

The earlier proposed volatility/Kelly formulas and integration sketches remain
in the [historical specification](../history/implementation-plans/architecture-position-sizing-layer.md).
They are design material, not enabled runtime behavior. Registration and version
requirements are in [adding a strategy](../guides/adding-a-strategy.md).
