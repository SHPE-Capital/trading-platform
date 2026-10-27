# Strategy catalog and runtime policy

The authoritative implementation is `backend/src/config/strategyCatalog.ts`,
`strategyManifest.ts`, `strategyDefaults.ts`, and `strategyPolicy.ts`.
[Adding a strategy](../guides/adding-a-strategy.md) covers the editing workflow;
this page owns the policy rules.

## Independent decisions

| Property | Meaning |
|---|---|
| `status` | Lifecycle: `planned`, `experimental`, `ready`, `retired` |
| `hidden` | Presentation: omit from pickers; not an authorization boundary |
| `backtestable` | Technical ability to use the historical engine; defaults to true |
| Policy profile + execution target | Where an experimental strategy may start trading |
| Authentication, ownership, approval, budgets | Additional checks; catalog eligibility does not bypass them |

| Status | Save new configuration | Backtest if capable | New trading runs |
|---|---|---|---|
| `planned` | No | Yes, explicit type request | No |
| `experimental` | Yes | Yes | Development sim or personal Alpaca paper runtime |
| `ready` | Yes | Yes | Eligible, subject to other permissions and approval |
| `retired` | No | Yes | No |

The table describes new configuration creation and new runs. Updating an
existing configuration follows the update endpoint's ownership and validation
checks; lifecycle status does not erase history. Existing runs are reconstructed
by factory type rather than gated again by release status.

## Profiles

`STRATEGY_POLICY_PROFILE=shared` is the default. It permits new trading runs only
for `ready` strategies. `development` additionally permits `experimental`
strategies when the execution target is `sim` or `alpaca-paper`. Live execution
always requires `ready`. `NODE_ENV` does not grant permissions.

Local Docker files explicitly select `development`. Production Compose pins
`shared`, and environment validation refuses `development` with
`APP_RUNTIME_ORIGIN=aws-prod`. Other shared deployments must select `shared`
explicitly. Broker account protection and real-money feature gates are separate
checks; a development profile never authorizes trading the club's account.

## Construction and UI

`STRATEGY_FACTORY` and `STRATEGY_DEFINITIONS` are derived from the same catalog.
The common constructor supplies an ID, pins the type, and delegates to the
manifest's `create(config)`, which must merge strategy defaults.

The backtest factory derives `BACKTESTABLE_TYPES` from definitions rather than
maintaining a pairs-only list. Capability is independent of status and visibility.
Historical data and supported event inputs are still required: a constructible
strategy is not necessarily meaningful on bar-only history.

`GET /api/strategies/configs/types` returns definitions excluding hidden and
planned entries, with server-derived `actions.save`, `actions.backtest`, and
`actions.startTrading` (`allowed` plus an optional `reason`). UI pickers use
those actions and available forms. Non-pairs forms use manifest `params`.
Request handlers enforce eligibility again; hiding an item is not enforcement.

The catalog currently registers pairs trading, minute reversal, and Beginner
Reversal as `ready`. Beginner Reversal is visible for UI verification and has
generic form parameters. A strategy directory by itself is not registration.

## Code and configuration versions

The class's `VERSION` is the algorithm version; manifests read it directly.
Saved immutable configuration versions record `algorithm_version` along with
settings, author, and change note. Trading runs execute current code even when
their settings were saved under an older algorithm. The UI can warn about that
mismatch; it cannot run old source code from a configuration record.

Backtest reuse also includes engine/algorithm identity so a changed engine or
algorithm does not silently reuse an older result. See
[backtest execution](backtest-execution.md) for clock and engine semantics.
