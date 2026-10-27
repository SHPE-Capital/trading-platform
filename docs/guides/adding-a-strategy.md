# Adding a strategy

A strategy is registered once in the strategy catalog. Its lifecycle and runtime
policy determine where it can trade; backtesting uses the same implementation.
No bespoke frontend code is needed if it describes its parameters.

## The four edits

1. **Write the strategy** in `backend/src/strategies/<name>/`: a class extending
   `BaseStrategy` with `evaluate()` and a `static readonly VERSION`.
2. **Name the type**: add it to `StrategyType` in `backend/src/types/strategy.ts`
   (and `frontend/types/strategy.ts` so the frontend types agree).
3. **Write its manifest**: `backend/src/strategies/<name>/manifest.ts` exporting a
   `StrategyManifest` (type in `backend/src/config/strategyManifest.ts`).
4. **List it** in `backend/src/config/strategyCatalog.ts`.

The reference implementation is `backend/src/strategies/beginnerReversal/`.

## What the manifest declares

| Field | Purpose |
|---|---|
| `type`, `label`, `description` | Identity and picker text |
| `status` | `planned`, `experimental`, `ready` or `retired`; see [policy](../architecture/strategy-policy.md) |
| `hidden` | Optional. Hide from every picker, independently of lifecycle |
| `backtestable` | Optional, defaults to `true`. Whether the common engine can simulate it |
| `version` | `YourStrategy.VERSION`. Read it from the class so they cannot drift |
| `defaultConfig` | Fully-populated config that pre-fills a new configuration |
| `create(config)` | Builds the strategy from a saved config; fill missing fields from defaults here |
| `params` | Optional. Fields for the generic form (`number`, `text`, `symbols`, `boolean`). Omit for a strategy with a bespoke form, or one that should not be offered in the UI |

## Construction, decision clock, and release

Trading, backtest workers, and the CLI use the same catalog-derived
`STRATEGY_FACTORY`. `create(config)` must fill missing fields from defaults;
the common factory supplies an ID and pins the type. There is no separate
backtest registration or frontend allowlist.

Declare `readonly triggers: readonly MarketEventKind[]` (for example `["bar"]`)
on the strategy. The orchestrator evaluates only those event kinds. The current
historical engine emits bars for decisions; sparse quotes/trades used to price
fills do not constitute a full quote/trade strategy feed.

Use `experimental` for a compiling prototype and review the
[lifecycle/profile eligibility rules](../architecture/strategy-policy.md) before
release. That page owns status, visibility, backtest capability, and runtime
profile behavior. `hidden` affects pickers, not request authorization.

After restarting the affected services, verify your definition and action
metadata at authenticated `GET /api/strategies/configs/types`, then exercise the
form and intended runtime. See [paper trading](live-paper-trading.md) for launch
steps and [backtesting](backtesting.md#cli-workflow) for CLI configuration.

## Why the catalog is in `config/`

`scripts/check-strategy-versions.mjs` fails CI when a file in
`backend/src/strategies/<dir>/` or `strategies/base/` changes without a `VERSION` bump.
A manifest is not algorithm behaviour, so the two older strategies (pairs trading,
minute reversal) are declared inline in `strategyCatalog.ts` rather than gaining a
manifest file that would force a bump. New strategies keep their manifest in their own
folder; it is part of their first version, so no bump is needed.

## Bump VERSION when behaviour changes

Each saved config version records the strategy's `VERSION` at the time (`strategy_versions.algorithm_version`).
A run always executes the *current* code, so after you bump `VERSION` the forms flag older saved versions
("saved for algorithm v1; the current algorithm is v2") instead of letting them surprise someone. CI enforces the bump
for existing strategies (`scripts/check-strategy-versions.mjs`).

## Make "why didn't it trade?" answerable

Log the reason when a guard you wrote suppresses a trade (info), and routine skips at debug. See
[troubleshooting](troubleshooting-strategies.md#for-strategy-authors). A manifest `validate()` hook (optional) rejects an
unrunnable config when it is saved instead of when it is started.

## Tests to write

- A unit test for `evaluate()` (see `backend/src/tests/strategy/beginnerReversalStrategy.test.ts`).
- Exercise catalog/policy expectations in `backend/src/tests/http/strategies.test.ts`
  and `backend/src/tests/core/strategyPolicy.test.ts` when changing eligibility.
- If supporting a new input/execution capability, test it through the historical
  engine as well; registration alone does not establish equivalent behavior.

All catalog entries are imported during compilation, including hidden/planned
entries. Keep code that does not compile on a branch. Commands and CI behavior
are documented in [testing](testing.md).
