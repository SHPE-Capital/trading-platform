/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  // Transpile-only. The default ts-jest preset type-checks every test file and its
  // full import graph, separately in each worker — the dominant cost of a cold run
  // across this suite. Types are still enforced, just once and in one place, by
  // `npm run typecheck` (tsc --noEmit over src and tests).
  transform: {
    '^.+[.]tsx?$': ['ts-jest', {
      tsconfig: '<rootDir>/tsconfig.spec.json',
      diagnostics: false,
    }],
  },
  testMatch: ['**/*.test.ts', '**/*.spec.ts'],
  // Jest's worker pool hangs on teardown on Windows: every suite reports its
  // result, then the run never finalizes. Verified with --detectOpenHandles that
  // no suite leaks a handle, so exiting once the results are in is safe. If a
  // suite ever does leak, re-run with --detectOpenHandles to find it.
  forceExit: true,
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  collectCoverageFrom: [
    'src/core/state/portfolioState.ts',
    'src/core/risk/riskEngine.ts',
    'src/core/backtest/backtestEngine.ts',
    'src/adapters/supabase/repositories.ts',
    'src/core/engine/orchestrator.ts',
    'src/core/oms/orderManager.ts',
    'src/core/oms/capitalReservation.ts',
    'src/core/oms/orderQueue.ts',
    'src/core/oms/priorityConfig.ts',
    'src/core/oms/parentChildOrder.ts',
  ],
  coverageThreshold: {
    global: {
      lines: 80,
    },
  },
};
