import {
  buildClock, computeStats, select, selectWithFallback, renderJson, renderMd, nearCutoffFlags, MOMENTUM, RULES,
  type AssetInfo, type RawBar, type Stats,
} from "../../../runtime/team3Analysis/selectUniverse";
import type { Member, Snapshot } from "../../../runtime/team3Analysis/membershipSnapshot";

// 2026-06-01 is a Monday; 9:30 ET (EDT) = 13:30Z.
const OPEN = Date.parse("2026-06-01T13:30:00Z");
const bar = (min: number, c: number, v = 1000): RawBar => ({ t: new Date(OPEN + min * 60_000).toISOString(), o: c, h: c, l: c, c, v });
/** A full session (390 bars) with closes from fn(minute). */
const session = (fn: (m: number) => number, skip: (m: number) => boolean = () => false): RawBar[] =>
  Array.from({ length: 390 }, (_, m) => m).filter((m) => !skip(m)).map((m) => bar(m, fn(m)));

describe("selectUniverse stats", () => {
  const spy = session((m) => 100 * Math.exp(0.001 * Math.sin(m)));
  const clock = buildClock(spy);

  it("expects 360 entry-window minutes per full day (9:45-15:44)", () => {
    expect([...clock.expected.values()]).toEqual([360]);
    expect(clock.spyRet.size).toBe(359); // returns between consecutive entry-window minutes only
  });

  it("realized vol is the std of within-window 1-minute log returns; beta and corr against SPY", () => {
    // Stock = 2x SPY's log moves -> beta 2, corr 1, vol 2x SPY's.
    const stock = session((m) => 50 * Math.exp(0.002 * Math.sin(m)));
    const s = computeStats("X", stock, clock);
    const spyS = computeStats("SPY", spy, clock);
    expect(s.returns).toBe(359);
    expect(s.beta).toBeCloseTo(2, 6);
    expect(s.corr).toBeCloseTo(1, 6);
    expect(s.vol / spyS.vol).toBeCloseTo(2, 6);
  });

  it("coverage counts missing entry-window minutes and gaps break returns", () => {
    const stock = session((m) => 50 + m * 0.01, (m) => m >= 100 && m < 136); // 36 minutes missing
    const s = computeStats("X", stock, clock);
    expect(s.coverage).toBeCloseTo((360 - 36) / 360, 10);
    expect(s.returns).toBe(359 - 37); // 36 missing minutes remove 37 returns
  });

  it("price is the session VWAP and dollar volume the sum of close x volume", () => {
    const s = computeStats("X", session(() => 40), clock);
    expect(s.price).toBeCloseTo(40, 10);
    expect(s.dollarVol).toBeCloseTo(40 * 1000 * 389, 4); // the 15:59 bar is outside the session (inRegularSession)
  });
});

// ---- selection logic on hand-made stats

const st = (symbol: string, o: Partial<Stats> = {}): Stats => ({
  symbol, days: 63, price: 100, dollarVol: 2e9, coverage: 1, vol: 0.001, beta: 1.5, corr: 0.6, stretch: 0.2, returns: 22_000, ...o,
});
const mem = (ticker: string, sector = "Information Technology", cik: string | null = null): Member =>
  ({ ticker, name: ticker, sector, sectorSource: "gics", cik, indices: ["sp500"] });
const asset = (symbol: string, name = `${symbol} Common Stock`): AssetInfo => ({ symbol, found: true, cls: "us_equity", tradable: true, name });

function world(extra: { m: Member; s: Stats; a?: AssetInfo }[]) {
  const members = [...MOMENTUM.map((t) => mem(t)), mem("SPY"), ...extra.map((e) => e.m)];
  const assets = new Map(extra.map((e) => [e.m.ticker, e.a ?? asset(e.m.ticker)]));
  const stats = new Map<string, Stats>([
    ["NVDA", st("NVDA", { vol: 0.0010, beta: 1.6 })], ["AMD", st("AMD", { vol: 0.0012, beta: 1.8 })],
    ["MU", st("MU", { vol: 0.0013, beta: 1.7 })], ["TSLA", st("TSLA", { vol: 0.0014, beta: 1.5 })],
    ["META", st("META", { vol: 0.0009, beta: 1.3 })],
    ...extra.map((e) => [e.m.ticker, e.s] as [string, Stats]),
  ]);
  return { members, assets, stats };
}

describe("selectUniverse selection", () => {
  it("excludes used symbols, ADRs and the less liquid share class, then applies thresholds in order", () => {
    const w = world([
      { m: mem("AAA"), s: st("AAA") },
      { m: mem("ADRX"), s: st("ADRX"), a: asset("ADRX", "Foo plc American Depositary Shares") },
      { m: mem("CLA", "Communication Services", "1"), s: st("CLA", { dollarVol: 3e9 }) },
      { m: mem("CLB", "Communication Services", "1"), s: st("CLB", { dollarVol: 2e9 }) },
      { m: mem("CHEAP"), s: st("CHEAP", { price: 19 }) },
      { m: mem("THIN"), s: st("THIN", { dollarVol: 9e8 }) },
      { m: mem("GAPPY"), s: st("GAPPY", { coverage: 0.98 }) },
      { m: mem("CALM"), s: st("CALM", { vol: 0.0002 }) },
    ]);
    const sel = select(w.members, w.assets, w.stats);
    expect(sel.log.map((l) => l.left)).toEqual([14, 8, 6, 5, 4, 3, 2, 2]);
    expect(sel.log[2].removed).toEqual(["ADRX", "CLB"]);
    expect(sel.selected.map((c) => c.symbol).sort()).toEqual(["AAA", "CLA"]);
    expect(sel.status.get("CALM")).toBe("outside Momentum range");
  });

  it("ranks by distance (ties alphabetical) and caps a sector at 8", () => {
    const extra = Array.from({ length: 12 }, (_, i) => {
      const t = `T${String(i).padStart(2, "0")}`;
      return { m: mem(t, i < 10 ? "Information Technology" : "Energy"), s: st(t, { vol: 0.00115 + i * 0.00001 }) };
    });
    extra.push({ m: mem("TIE"), s: st("TIE", { vol: 0.00116 }) }); // identical to T01, the closest to the centroid
    const sel = select(world(extra).members, world(extra).assets, world(extra).stats);
    const it = sel.selected.filter((c) => c.sector === "Information Technology");
    expect(it.length).toBe(RULES.perSector);
    expect(sel.ranked[0].symbol).toBe("T01");
    expect(sel.ranked[1].symbol).toBe("TIE");
    expect(sel.selected.map((c) => c.symbol)).toEqual(expect.arrayContaining(["T10", "T11"]));
    expect(sel.skippedForSector.length).toBeGreaterThan(0);
  });

  it("falls back to the $500M floor once when fewer than 25 pass", () => {
    const extra = Array.from({ length: 30 }, (_, i) => {
      const t = `S${String(i).padStart(2, "0")}`;
      return { m: mem(t, `Sector${i % 5}`), s: st(t, { dollarVol: i < 10 ? 2e9 : 7e8 }) };
    });
    const w = world(extra);
    const sel = selectWithFallback(w.members, w.assets, w.stats);
    expect(sel.fallbackUsed).toBe(true);
    expect(sel.dollarFloor).toBe(5e8);
    expect(sel.selected.length).toBe(25);
  });

  it("renders byte-identically from the same inputs", () => {
    const extra = Array.from({ length: 5 }, (_, i) => ({ m: mem(`R${i}`), s: st(`R${i}`, { vol: 0.001 + i * 1e-5 }) }));
    const snap: Snapshot = {
      cutoff: "2026-08-31T23:59:59Z",
      sources: { sp500: { title: "a", revid: 1, timestamp: "2026-08-19T00:00:00Z" }, ndx100: { title: "b", revid: 2, timestamp: "2026-08-11T00:00:00Z" } },
      members: [],
    };
    const out = () => {
      const w = world(extra);
      const sel = select(w.members, w.assets, w.stats);
      const flags = nearCutoffFlags(sel, w.stats);
      return renderJson(snap, sel, [], flags) + renderMd(snap, sel, [], flags);
    };
    expect(out()).toBe(out());
  });
});
