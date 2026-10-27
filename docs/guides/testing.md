# Testing

Backend tests use Jest; frontend tests use Vitest and Testing Library. Run
commands from the package directory shown below. Dependency setup belongs to
[local development](local-development.md).

## Backend checks

From `backend/`:

```text
npm run typecheck
npm run lint
npm test -- --runInBand
npm run build
```

Jest transpiles tests without type-checking their import graphs, so a passing
test run does not replace `npm run typecheck` (which includes tests).

| Command | Scope under `backend/src/tests/` |
|---|---|
| `npm run test:unit` | Core, repositories, utilities, adapters, strategy, services, controllers and benchmark suites |
| `npm run test:int` | Synthetic end-to-end engine tests under `int/` |
| `npm run test:http` | Supertest HTTP contracts under `http/` |
| `npm run test:ci` | Jest with coverage and its configured threshold |
| `npm run test:live` | Explicit integration opt-in; inspect credentials/targets and individual tests before running |

For one strategy, for example:

```text
npm test -- --runInBand src/tests/strategy/beginnerReversalStrategy.test.ts
```

Ordinary unit/HTTP/benchmark suites use mocks or local synthetic input.
Executable benchmarks are separate commands: see
[latency benchmark](latency-benchmark.md).

## Frontend checks

From `frontend/`:

```text
npm run lint
npm test
npm run build
```

Tests live under `frontend/__tests__/`. Supply the build's required public
Supabase configuration as described in the environment template/CI workflow.

## Coverage and CI

`backend/jest.config.js` collects coverage from an explicit list of accounting,
risk, backtest, orchestration, reservation/OMS, and repository files, with a
**global 80% line threshold** for that list. It is not an independent 80% gate
on every directory. `test:ci` enables it.

The current `.github/workflows/ci.yml` runs backend typecheck, lint, tests, and
build; frontend lint, tests, and build; and a backend Docker build. Its backend
test command is ordinary `npm test -- --runInBand`, not `test:ci`, so the workflow
does not currently enable that coverage gate. The separate `.github/workflows/strategy-version.yml` runs
`scripts/check-strategy-versions.mjs` on pull requests, including label changes.
It compares against the target branch and supports the documented
`strategy-version-unchanged` override for behavior-neutral changes.

## Accounting and behavioral checks

Portfolio/engine suites check cash, marked position value, fills, fees and
realized/unrealized PnL. The basic equity identity is:

```text
equity = cash + signed marked position value
```

When reconciling equity change to realized plus unrealized PnL, account for
commissions/fees according to the metric's definition. These invariants belong
to the relevant accounting suites; not every HTTP/UI test asserts them.
For behavior changes, test decision timing, risk rejection, partial fills,
reservation release, and algorithm-version changes where applicable.
