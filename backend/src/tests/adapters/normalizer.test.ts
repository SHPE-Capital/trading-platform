import {
  normalizeQuote,
  normalizeTrade,
  normalizeBar,
} from '../../adapters/alpaca/normalizer';

// isoToMs is used inside normalizer; we just verify ts is a number
const ISO = '2024-01-15T10:30:00.000Z';

describe('normalizeQuote', () => {
  const raw = {
    S: 'SPY',
    bp: 100.0,
    ap: 100.1,
    bs: 200,
    as: 100,
    t: ISO,
    x: 'NYSE',
    c: ['R'],
  };

  it('maps symbol correctly', () => {
    expect(normalizeQuote(raw).symbol).toBe('SPY');
  });

  it('maps bid and ask prices', () => {
    const q = normalizeQuote(raw);
    expect(q.bidPrice).toBe(100.0);
    expect(q.askPrice).toBe(100.1);
  });

  it('computes midPrice as (bid+ask)/2', () => {
    expect(normalizeQuote(raw).midPrice).toBeCloseTo(100.05, 5);
  });

  it('computes spread as ask - bid', () => {
    expect(normalizeQuote(raw).spread).toBeCloseTo(0.1, 5);
  });

  it('computes size-weighted microPrice', () => {
    // microPrice = (askSize*bid + bidSize*ask) / totalSize
    // = (100*100 + 200*100.1) / 300 = (10000 + 20020) / 300 = 30020/300 ≈ 100.0667
    expect(normalizeQuote(raw).microPrice).toBeCloseTo(100.0667, 3);
  });

  it('computes imbalance as (bidSize - askSize) / totalSize', () => {
    // (200-100)/300 ≈ 0.333
    expect(normalizeQuote(raw).imbalance).toBeCloseTo(0.3333, 3);
  });

  it('ts is a numeric epoch ms derived from ISO', () => {
    expect(typeof normalizeQuote(raw).ts).toBe('number');
    expect(normalizeQuote(raw).ts).toBeGreaterThan(0);
  });

  it('preserves isoTs, exchange, and conditions', () => {
    const q = normalizeQuote(raw);
    expect(q.isoTs).toBe(ISO);
    expect(q.exchange).toBe('NYSE');
    expect(q.conditions).toEqual(['R']);
  });
});

describe('normalizeTrade', () => {
  const raw = {
    S: 'AAPL',
    p: 185.5,
    s: 300,
    t: ISO,
    x: 'NASDAQ',
    z: 'C',
    c: ['@'],
    i: 12345,
  };

  it('maps symbol, price, size', () => {
    const t = normalizeTrade(raw);
    expect(t.symbol).toBe('AAPL');
    expect(t.price).toBe(185.5);
    expect(t.size).toBe(300);
  });

  it('converts timestamp to epoch ms', () => {
    expect(typeof normalizeTrade(raw).ts).toBe('number');
  });

  it('maps exchange, tape, conditions, id', () => {
    const t = normalizeTrade(raw);
    expect(t.exchange).toBe('NASDAQ');
    expect(t.tape).toBe('C');
    expect(t.conditions).toEqual(['@']);
    expect(t.id).toBe('12345');
  });
});

describe('normalizeBar', () => {
  const raw = {
    S: 'QQQ',
    o: 350.0,
    h: 355.0,
    l: 349.0,
    c: 353.0,
    v: 1_000_000,
    vw: 352.5,
    n: 5000,
    t: ISO,
  };

  it('maps OHLCV and symbol', () => {
    const b = normalizeBar(raw, '1m');
    expect(b.symbol).toBe('QQQ');
    expect(b.open).toBe(350.0);
    expect(b.high).toBe(355.0);
    expect(b.low).toBe(349.0);
    expect(b.close).toBe(353.0);
    expect(b.volume).toBe(1_000_000);
  });

  it('maps vwap and tradeCount', () => {
    const b = normalizeBar(raw, '1m');
    expect(b.vwap).toBe(352.5);
    expect(b.tradeCount).toBe(5000);
  });

  it('passes timeframe through', () => {
    expect(normalizeBar(raw, '5m').timeframe).toBe('5m');
    expect(normalizeBar(raw, '1d').timeframe).toBe('1d');
  });

  it('converts timestamp to epoch ms', () => {
    expect(typeof normalizeBar(raw, '1m').ts).toBe('number');
  });
});
