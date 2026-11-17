import { volTargetQty } from '../../../strategies/team3Reversal/sizing';
import { fakeBar, fakeHistory } from './helpers';

describe('volTargetQty: fewer shares when the stock is jumpier', () => {
  it('returns 0 with too little history', () => {
    expect(volTargetQty(fakeHistory([100, 101]), fakeBar(0, 100), 25)).toBe(0);
  });
  it('returns 0 when price never moves (no volatility to size by)', () => {
    expect(volTargetQty(fakeHistory([100, 100, 100, 100, 100, 100]), fakeBar(0, 100), 25)).toBe(0);
  });
  it('sizes a calm stock bigger than a jumpy one at the same price', () => {
    const calm = volTargetQty(fakeHistory([100, 100.1, 100, 100.1, 100, 100.1]), fakeBar(0, 100), 25);
    const jumpy = volTargetQty(fakeHistory([100, 101, 100, 101, 100, 101]), fakeBar(0, 100), 25);
    expect(calm).toBeGreaterThan(jumpy);
    expect(jumpy).toBeGreaterThan(0);
  });
  it('matches floor(risk / (sigma x price))', () => {
    const closes = [100, 101, 100, 101, 100, 101];
    const qty = volTargetQty(fakeHistory(closes), fakeBar(0, 100), 25);
    const all = [...closes, 100];
    const r = all.slice(1).map((c, i) => c / all[i] - 1);
    const mean = r.reduce((a, b) => a + b, 0) / r.length;
    const sdPop = Math.sqrt(r.reduce((a, b) => a + (b - mean) ** 2, 0) / r.length);
    const sdSample = Math.sqrt(r.reduce((a, b) => a + (b - mean) ** 2, 0) / (r.length - 1));
    expect([Math.floor(25 / (sdPop * 100)), Math.floor(25 / (sdSample * 100))]).toContain(qty);
  });
});
