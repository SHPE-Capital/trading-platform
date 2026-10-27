# Risk layer

`backend/src/core/risk/riskEngine.ts` validates order intents and monitors the
portfolio. Types live in `backend/src/types/risk.ts`; configured defaults live in
`backend/src/config/defaults.ts`. These checks are implemented, including cash
reserve, drawdown, and concentration checks previously described as stubs.

## Pre-trade checks

`check()` rejects a non-positive quantity, then runs checks in this order,
returning the first failure:

| Check | Behavior |
|---|---|
| `KILL_SWITCH` | Blocks ordinary order intents while active |
| `MARKET_CLOSED` | Requires an open session when a market-hours provider is installed |
| `STALE_QUOTE` | Rejects a known reference timestamp older than the configured threshold |
| `ORDER_COOLDOWN` | Throttles the same strategy **and symbol** |
| `MAX_POSITION_SIZE` | Caps projected absolute per-symbol notional |
| `MAX_NOTIONAL_EXPOSURE` | Caps projected total absolute position notional |
| `SHORT_SELLING_DISALLOWED` | Rejects sales beyond held shares when shorting is disabled |
| `CASH_RESERVE` | Enforces spendable cash/reserve rules, including short-opening checks |
| `INTRADAY_DRAWDOWN` | Checks the session equity baseline and can engage the kill switch |
| `CONCENTRATION_LIMIT` | Caps projected symbol value as a fraction of equity |

Position and exposure limits value holdings at current reference prices. Cash
and reservation calculations use an adverse fill estimate, including gap/spread
buffers for market orders. A stop uses the worse relevant mid/stop reference.
Missing price/timestamp handling is explicit in the implementation: some
individual checks skip when they cannot resolve a reference, while the
orchestrator rejects an intent without a usable worst-case price before reserving.

`preflightCheck()` runs the same guards without recording a cooldown. It still
initializes the session baseline and drawdown checks can engage the kill switch;
it is not wholly free of state changes. It supports multi-leg preflight; see
[OMS](oms-layer.md).

## Strategy budgets and capital

After ordinary risk checks, the orchestrator checks the strategy's registered
budget against equity, outstanding reservations, and open-order count. Rejection
names include `STRATEGY_BUDGET`, `STRATEGY_ORDER_NOTIONAL`, and `MAX_OPEN_ORDERS`.
Then it reserves capital. Reservation accounting and terminal-order handling
belong to [OMS](oms-layer.md); reservations are not broker margin modeling.

## Portfolio checks and emergency handling

`checkPortfolio()` evaluates optional gross/net exposure ratios and drawdown.
The orchestrator calls it after price updates and fills, so an existing position
can trigger action without a new strategy signal. On a violation requesting a
kill switch, the orchestrator engages it and initiates emergency flattening.
That flattening path deliberately bypasses ordinary pre-trade risk checks.
It submits close requests; broker acceptance and fills remain asynchronous.

The drawdown baseline is held in the `RiskEngine` instance. Do not assume it is
automatically persisted across restarts or reset at every market-day boundary;
inspect initialization/reset calls when changing session behavior.

## Configuration and investigation

`RiskConfig` is the full field contract. `DEFAULT_RISK_CONFIG` sets common
defaults, including a 10-second stale-price threshold, short selling enabled,
5% drawdown, 30% symbol concentration, 5% cash reserve, and 20/5 bps gap/spread
buffers. Position, notional and cooldown values are loaded from environment
configuration. Backtests use the backtest defaults, including zero order cooldown.
Optional gross/net exposure limits are inactive unless configured.

Strategy settings are not automatically global risk settings: returning a
quantity does not override the runner's limits. For rejected orders, start with
the named check in [strategy troubleshooting](../guides/troubleshooting-strategies.md).
For changes, exercise the risk and orchestrator suites described in
[testing](../guides/testing.md), including missing reference data, closing trades,
multi-leg preflight, and reservation release.
