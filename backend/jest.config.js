/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts', '**/*.spec.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  collectCoverageFrom: [
    'src/core/state/portfolioState.ts',
    'src/core/risk/riskEngine.ts',
    'src/core/backtest/backtestEngine.ts',
    'src/adapters/supabase/repositories.ts',
    'src/core/engine/orchestrator.ts',
  ],
  coverageThreshold: {
    global: {
      lines: 80,
    },
  },
};
