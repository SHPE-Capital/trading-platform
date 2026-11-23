# Trading platform agent guidance

Read README.md and docs/README.md for the actual architecture and current runbooks. The backend is TypeScript/Express, with adapters, a synchronous event bus, shared trading/backtest/replay engine, risk checks, and persistence. The frontend is Next.js/React; frontend/AGENTS.md requires reading the installed Next.js documentation before code changes.

## Commands and boundaries

Inspect package.json files for current commands. Root tooling includes npm run doctor and stack setup/start/stop/reset scripts. Frontend checks include npm --prefix frontend run lint, npm --prefix frontend run test, and npm --prefix frontend run build. Backend checks include npm --prefix backend run typecheck, npm --prefix backend run lint, and focused Jest tests (npm --prefix backend test -- --runInBand <test-path>). These commands were identified from package scripts; verify prerequisites and distinguish static/unit checks from integration checks needing services.

Do not run the combined backend dev command casually: it includes both paper and real trading runtimes. Setup, data pulls, database migrations/resets, deployments, broker calls, and trading runtime launches are separate operations, not incidental checks for an agent-configuration or documentation task. Preserve existing environment files and credentials outside Git.

## Engineering invariants

Preserve synchronous in-order event dispatch and deterministic replay. Keep broker-specific behavior in adapters and the shared engine consistent across modes. Preserve risk controls and live-trading gates. Coordinate database schema, API/WebSocket contracts, and frontend types with their actual callers; do not silently change semantics.

## Delegation

Use project frontend/backend agents for substantial independent slices after the primary defines the shared contract and file ownership. Backend owns its assigned server/engine paths, frontend owns its assigned UI paths; shared contracts, migrations, and root/deployment config require coordination. Keep tightly coupled small fixes with one agent. Each implementer verifies its work; the primary integrates and verifies the end-to-end result. Use an independent reviewer for substantial behavior changes and validator for bounded reproduction or difficult failures. Do not add a separate manager layer.
