/**
 * tests/strategy/team3Reversal/envMock.ts
 *
 * The env every engine-level Team 3 test runs with. Use it at the top of a test file:
 *   jest.mock('../../../config/env', () => require('./envMock'));
 */

export const env = {
  alpacaApiKey: 'test-key',
  alpacaApiSecret: 'test-secret',
  alpacaTradingMode: 'paper',
  alpacaPaperBaseUrl: 'https://paper-api.alpaca.markets',
  alpacaLiveBaseUrl: 'https://api.alpaca.markets',
  alpacaDataStreamUrl: 'wss://stream.data.alpaca.markets/v2',
  alpacaPaperStreamUrl: 'wss://paper-api.alpaca.markets/stream',
  alpacaLiveStreamUrl: 'wss://api.alpaca.markets/stream',
  supabaseUrl: 'https://test.supabase.co',
  supabaseAnonKey: 'test-anon',
  supabaseServiceRoleKey: 'test-service',
  port: 8080,
  nodeEnv: 'test',
  corsOrigin: 'http://localhost:3000',
  logLevel: 'error',
  defaultRollingWindowMs: 60_000,
  maxPositionSizeUsd: 10_000,
  maxNotionalExposureUsd: 50_000,
  orderCooldownMs: 5_000,
  enableLiveTrading: false,
  enableWebSocketPush: true,
  databaseUrl: '',
};
