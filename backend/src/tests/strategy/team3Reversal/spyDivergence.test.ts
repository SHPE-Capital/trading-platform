import { spyDivergenceIdea } from '../../../strategies/team3Reversal/rules';
import { createTeam3ReversalConfig, validateTeam3ReversalConfig } from '../../../strategies/team3Reversal/team3ReversalConfig';
import { fakeBar, fakeVwap } from './helpers';

const c = createTeam3ReversalConfig({ id: 'div', useSpyDivergence: true });   // divMinZ 1.5, divSpyZ 1, crossings 1-2
const prev = fakeBar(-1, 100);

describe('spyDivergenceIdea (S5 candidate 1): stock stretched, SPY stretched the other way, 1-2 crossings', () => {
  it('sells a stock above VWAP while SPY is below its own', () => {
    const idea = spyDivergenceIdea(fakeBar(0, 101), prev, fakeVwap({ z: 1.8, crossings: 2 }), fakeVwap({ z: -1.2 }), c);
    expect(idea).toMatchObject({ side: 'sell', z: 1.8 });
  });
  it('buys a stock below VWAP while SPY is above, whatever the bar direction', () => {
    expect(spyDivergenceIdea(fakeBar(0, 99.5), fakeBar(-1, 99), fakeVwap({ z: -2.0, crossings: 1 }), fakeVwap({ z: 1.0 }), c)?.side).toBe('buy');
  });
  it('skips when SPY is on the same side, or within 1 sigma', () => {
    expect(spyDivergenceIdea(fakeBar(0, 101), prev, fakeVwap({ z: 1.8, crossings: 1 }), fakeVwap({ z: 1.5 }), c)).toBeNull();
    expect(spyDivergenceIdea(fakeBar(0, 101), prev, fakeVwap({ z: 1.8, crossings: 1 }), fakeVwap({ z: -0.9 }), c)).toBeNull();
  });
  it('skips outside 1.5 <= |z| < stopZ and outside 1-2 crossings', () => {
    expect(spyDivergenceIdea(fakeBar(0, 101), prev, fakeVwap({ z: 1.4, crossings: 1 }), fakeVwap({ z: -2 }), c)).toBeNull();
    expect(spyDivergenceIdea(fakeBar(0, 101), prev, fakeVwap({ z: 3.5, crossings: 1 }), fakeVwap({ z: -2 }), c)).toBeNull();
    expect(spyDivergenceIdea(fakeBar(0, 101), prev, fakeVwap({ z: 2, crossings: 0 }), fakeVwap({ z: -2 }), c)).toBeNull();
    expect(spyDivergenceIdea(fakeBar(0, 101), prev, fakeVwap({ z: 2, crossings: 3 }), fakeVwap({ z: -2 }), c)).toBeNull();
  });
  it('needs SPY data, and validation keeps the benchmark in symbols', () => {
    expect(spyDivergenceIdea(fakeBar(0, 101), prev, fakeVwap({ z: 2, crossings: 1 }), null, c)).toBeNull();
    expect(() => validateTeam3ReversalConfig(createTeam3ReversalConfig({ useSpyDivergence: true, symbols: ['AAPL'] }))).toThrow(/benchmarkSymbol/);
  });
});
