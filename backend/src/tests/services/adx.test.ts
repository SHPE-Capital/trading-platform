import { WilderAdx } from '../../services/indicators/adx';

// Hand-worked series, period 2.
// bar: H  L  C    +DM -DM TR
// b0 : 10 8  9
// b1 : 12 9  11   2   0   max(3,3,0)=3
// b2 : 13 10 12   1   0   max(3,2,1)=3
// b3 : 13 9  10   0   1   max(4,1,3)=4
// b4 : 15 11 14   2   0   max(4,5,1)=5
//
// b2 (n=period): sums TR=6 +DM=3 -DM=0 -> +DI=50, -DI=0, DX=100 (DX #1)
// b3: TR=6-3+4=7, +DM=3-1.5+0=1.5, -DM=0-0+1=1
//     +DI=150/7, -DI=100/7, DX=100*0.5/2.5=20 (DX #2) -> ADX seed=(100+20)/2=60
// b4: TR=7-3.5+5=8.5, +DM=1.5-0.75+2=2.75, -DM=1-0.5+0=0.5
//     +DI=275/8.5, -DI=50/8.5, DX=100*2.25/3.25=900/13
//     ADX=(60*1+900/13)/2
const bars = [
  { high: 10, low: 8, close: 9 },
  { high: 12, low: 9, close: 11 },
  { high: 13, low: 10, close: 12 },
  { high: 13, low: 9, close: 10 },
  { high: 15, low: 11, close: 14 },
];

describe('WilderAdx', () => {
  it('is fully NaN until `period` observations exist', () => {
    const adx = new WilderAdx(2);
    const r0 = adx.update(bars[0]);
    const r1 = adx.update(bars[1]);
    for (const r of [r0, r1]) {
      expect(r.adx).toBeNaN();
      expect(r.plusDi).toBeNaN();
      expect(r.minusDi).toBeNaN();
    }
  });

  it('produces DI at index `period` but ADX only at index 2*period-1', () => {
    const adx = new WilderAdx(2);
    adx.update(bars[0]);
    adx.update(bars[1]);
    const r2 = adx.update(bars[2]);
    expect(r2.plusDi).toBeCloseTo(50, 10);
    expect(r2.minusDi).toBeCloseTo(0, 10);
    expect(r2.adx).toBeNaN();

    const r3 = adx.update(bars[3]);
    expect(r3.plusDi).toBeCloseTo(150 / 7, 10);
    expect(r3.minusDi).toBeCloseTo(100 / 7, 10);
    expect(r3.adx).toBeCloseTo(60, 10);
  });

  it('smooths ADX with Wilder after the seed', () => {
    const adx = new WilderAdx(2);
    const out = bars.map((b) => adx.update(b));
    expect(out[4].plusDi).toBeCloseTo(275 / 8.5, 10);
    expect(out[4].minusDi).toBeCloseTo(50 / 8.5, 10);
    expect(out[4].adx).toBeCloseTo((60 + 900 / 13) / 2, 10);
  });

  it('gives DM to neither side when the moves are equal or non-positive', () => {
    const adx = new WilderAdx(1);
    adx.update({ high: 10, low: 8, close: 9 });
    // inside bar: upMove -0.5, downMove -0.5 -> +DM = -DM = 0; TR = max(1, 0.5, 0.5) = 1
    const r = adx.update({ high: 9.5, low: 8.5, close: 9 });
    expect(r.plusDi).toBeCloseTo(0, 10);
    expect(r.minusDi).toBeCloseTo(0, 10);
    expect(r.adx).toBeNaN(); // +DI + -DI = 0: DX undefined, invalid
  });

  it('is invalid on a flat series (zero smoothed TR)', () => {
    const adx = new WilderAdx(2);
    const flat = { high: 5, low: 5, close: 5 };
    adx.update(flat);
    adx.update(flat);
    const r = adx.update(flat);
    expect(r.adx).toBeNaN();
    expect(r.plusDi).toBeNaN();
  });

  it('rejects an invalid period', () => {
    expect(() => new WilderAdx(0)).toThrow(RangeError);
  });
});
