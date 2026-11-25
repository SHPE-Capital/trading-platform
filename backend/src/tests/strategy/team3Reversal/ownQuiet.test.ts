import { ownQuietIdea } from '../../../strategies/team3Reversal/rules';
import { createTeam3ReversalConfig, validateTeam3ReversalConfig } from '../../../strategies/team3Reversal/team3ReversalConfig';
import { fakeBar, fakeVwap } from './helpers';

const c = createTeam3ReversalConfig({ id: 'oq', useOwnQuietEntry: true });   // own share > 0.945, day move <= 47.1 bps
const series = (closes: number[]) => closes.map((x, i) => ({ ...fakeBar(i, x), open: i === 0 ? 100 : x }));

describe('ownQuietIdea (S5 candidate 2): a stock-specific stretch on a quiet day', () => {
  it('sells when the move is the stock\'s own (SPY flat) and the day is still near its open', () => {
    const stock = series([100, 100.1, 100.2, 100.3]);           // +30 bps on the day
    const spy = series([100, 100, 100, 100]);
    expect(ownQuietIdea(stock, spy, fakeVwap({ z: 2 }), c)).toMatchObject({ side: 'sell', z: 2 });
  });
  it('skips when SPY made most of the move', () => {
    const stock = series([100, 100.1, 100.2, 100.3]);
    const spy = series([100, 100.1, 100.2, 100.3]);
    expect(ownQuietIdea(stock, spy, fakeVwap({ z: 2 }), c)).toBeNull();
  });
  it('skips a day that has already moved more than 47.1 bps', () => {
    const stock = series([100, 100.3, 100.5, 100.6]);           // +60 bps
    expect(ownQuietIdea(stock, series([100, 100, 100, 100]), fakeVwap({ z: 2 }), c)).toBeNull();
  });
  it('skips outside 1.5 <= |z| < stopZ, and without SPY bars', () => {
    const stock = series([100, 100.1, 100.2, 100.3]), spy = series([100, 100, 100, 100]);
    expect(ownQuietIdea(stock, spy, fakeVwap({ z: 1.4 }), c)).toBeNull();
    expect(ownQuietIdea(stock, spy, fakeVwap({ z: 3.6 }), c)).toBeNull();
    expect(ownQuietIdea(stock, [], fakeVwap({ z: 2 }), c)).toBeNull();
  });
  it('one entry mode at a time', () => {
    expect(() => validateTeam3ReversalConfig(createTeam3ReversalConfig({ useOwnQuietEntry: true, useSpyDivergence: true }))).toThrow(/one entry mode/);
  });
});
