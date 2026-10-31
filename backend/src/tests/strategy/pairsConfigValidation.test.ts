jest.mock('../../config/env', () => ({ env: {} }));

import { createPairsConfig, validatePairsConfig } from '../../strategies/pairs/pairsConfig';
import { configProblem } from '../../config/strategyDefaults';

describe('validatePairsConfig: maxHoldingTimeMs', () => {
  it('accepts the default and the bounds', () => {
    expect(() => validatePairsConfig(createPairsConfig('A', 'B'))).not.toThrow();
    expect(() => validatePairsConfig({ maxHoldingTimeMs: 60_000 })).not.toThrow();
    expect(() => validatePairsConfig({ maxHoldingTimeMs: 527_040 * 60_000 })).not.toThrow();
  });

  it.each([NaN, Infinity, 0, -1, 59_999, 1.5, undefined as unknown as number])('rejects %p', (v) => {
    expect(() => validatePairsConfig({ maxHoldingTimeMs: v })).toThrow(/maxHoldingTimeMs/);
  });

  it('rejects a value over one year and says it is milliseconds', () => {
    expect(() => validatePairsConfig({ maxHoldingTimeMs: 527_040 * 60_000 + 1 })).toThrow(/milliseconds/);
  });

  it('is reported at save time through configProblem', () => {
    expect(configProblem('pairs_trading', { leg1Symbol: 'A', leg2Symbol: 'B', maxHoldingTimeMs: NaN })).toMatch(/maxHoldingTimeMs/);
    expect(configProblem('pairs_trading', { leg1Symbol: 'A', leg2Symbol: 'B' })).toBeNull();
  });

  it('does not constrain other strategies', () => {
    expect(configProblem('beginner_reversal', { maxHoldingTimeMs: NaN })).toBeNull();
  });
});
