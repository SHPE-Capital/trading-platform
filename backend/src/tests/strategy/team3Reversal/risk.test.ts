import { capQty, grossUsd } from '../../../strategies/team3Reversal/risk';

const caps = { maxSymbolUsd: 10_000, maxGrossUsd: 25_000 };

describe('capQty: whole shares within the $ per symbol and $ gross caps', () => {
  it('passes the wanted qty when there is room', () => {
    expect(capQty({ want: 50, price: 100, symbolUsd: 0, grossUsd: 0 }, caps)).toBe(50);
  });
  it('trims to the per-symbol cap', () => {
    expect(capQty({ want: 500, price: 100, symbolUsd: 0, grossUsd: 0 }, caps)).toBe(100);
  });
  it('trims to the gross cap', () => {
    expect(capQty({ want: 100, price: 100, symbolUsd: 0, grossUsd: 22_000 }, caps)).toBe(30);
  });
  it('returns 0 with no room, a bad price or nothing wanted', () => {
    expect(capQty({ want: 10, price: 100, symbolUsd: 0, grossUsd: 25_000 }, caps)).toBe(0);
    expect(capQty({ want: 10, price: 0, symbolUsd: 0, grossUsd: 0 }, caps)).toBe(0);
    expect(capQty({ want: 0, price: 100, symbolUsd: 0, grossUsd: 0 }, caps)).toBe(0);
  });
});

describe('grossUsd: shorts count the same as longs', () => {
  it('sums |shares| x price', () => {
    const prices: Record<string, number> = { AAPL: 100, TSLA: 200 };
    expect(grossUsd([['AAPL', 10], ['TSLA', -5]], (s) => prices[s])).toBe(2_000);
  });
});
