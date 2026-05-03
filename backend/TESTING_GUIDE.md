# Testing Infrastructure Guide

This repository uses a tiered testing architecture powered by **Jest** to ensure the integrity of the trading engine, accounting ledger, and persistence pipeline.

## Test Layers

1. **Unit Tests** (`test/unit/*.test.ts`)
   - Hermetic tests for individual modules.
   - **PortfolioState**: Validates ledger invariants (CHECK 7), long/short flips, and MTM accounting.
   - **RiskEngine**: Verifies position limits, notional exposure, and short-selling gates.
   - **Downsampling**: Ensures equity curve compression preserves critical data points.

2. **Integration Tests** (`test/int/*.test.ts`)
   - End-to-end backtest runs using synthetic data streams.
   - Verifies the full pipeline: Orchestrator → Strategy → Execution → Portfolio → Metrics.
   - Ensures deterministic results and accounting reconciliation at the engine level.

3. **HTTP Contract Tests** (`test/http/*.test.ts`)
   - Verifies API endpoint behavior using `supertest`.
   - Mocks the engine to test controller logic, request validation, and status codes (e.g., 202 Accepted for backtest runs).

## Running Tests

```bash
# Run all tests
npm test

# Run unit tests only (fastest)
npm run test:unit

# Run integration tests only
npm run test:int

# Run HTTP tests only
npm run test:http

# Run full CI suite with coverage gate (80% threshold)
npm run test:ci
```

## Coverage Thresholds

The CI suite enforces an **80% line coverage** threshold on the following critical directories:
- `src/core/backtest` (Backtest Engine)
- `src/core/state` (Portfolio/Symbol State)
- `src/core/risk` (Risk Engine)
- `src/adapters/supabase` (Persistence Repositories)

## Key Accounting Invariants (CHECK 7)

All tests verify the following identity:
`Equity = Cash + PositionsValue`
`TotalReturn = TotalRealizedPnL + TotalUnrealizedPnL = FinalEquity - InitialCapital`
