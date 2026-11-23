/**
 * runtime/team3Analysis/groups.ts
 *
 * Condition groups (1, 2 or 3 feature bins ANDed), their per-universe / per-half
 * counts and mean edge, the flag rule, and the shuffle nulls.
 * Universe 0 = Momentum (main), 1 = Core (control). Half 0 = 09-01..09-23, 1 = 09-24..10-15.
 * Owner: team lead. Pure: no I/O.
 */

export interface Rec { u: 0 | 1; h: 0 | 1; bins: Int8Array; edge: number }
/** A group is a list of [feature, bin] pairs, features strictly increasing. */
export type Group = ReadonlyArray<readonly [number, number]>;

/** Every single bin, every pair of bins of 2 different features, and every triple (all features; filter later). */
export function enumerateGroups(binsPerFeature: readonly number[]): Group[] {
  const F = binsPerFeature.length, out: Group[] = [];
  for (let a = 0; a < F; a++) for (let x = 0; x < binsPerFeature[a]; x++) out.push([[a, x]]);
  for (let a = 0; a < F; a++) for (let b = a + 1; b < F; b++)
    for (let x = 0; x < binsPerFeature[a]; x++) for (let y = 0; y < binsPerFeature[b]; y++) out.push([[a, x], [b, y]]);
  for (let a = 0; a < F; a++) for (let b = a + 1; b < F; b++) for (let c = b + 1; c < F; c++)
    for (let x = 0; x < binsPerFeature[a]; x++) for (let y = 0; y < binsPerFeature[b]; y++) for (let z = 0; z < binsPerFeature[c]; z++)
      out.push([[a, x], [b, y], [c, z]]);
  return out;
}

export const groupKey = (g: Group): string => g.map(([f, b]) => `${f}:${b}`).join("&");

export const inGroup = (bins: Int8Array, g: Group): boolean => g.every(([f, b]) => bins[f] === b);

/** CSR list of the groups each record belongs to. */
export function membership(recs: readonly Rec[], groups: readonly Group[]): { off: Int32Array; ids: Int32Array } {
  const idx = new Map(groups.map((g, i) => [groupKey(g), i]));
  const off = new Int32Array(recs.length + 1);
  const ids: number[] = [];
  recs.forEach((r, n) => {
    const F = r.bins.length;
    for (let a = 0; a < F; a++) {
      if (r.bins[a] < 0) continue;
      const ga = idx.get(`${a}:${r.bins[a]}`); if (ga !== undefined) ids.push(ga);
      for (let b = a + 1; b < F; b++) {
        if (r.bins[b] < 0) continue;
        const kab = `${a}:${r.bins[a]}&${b}:${r.bins[b]}`;
        const gab = idx.get(kab); if (gab !== undefined) ids.push(gab);
        for (let c = b + 1; c < F; c++) {
          if (r.bins[c] < 0) continue;
          const g3 = idx.get(`${kab}&${c}:${r.bins[c]}`); if (g3 !== undefined) ids.push(g3);
        }
      }
    }
    off[n + 1] = ids.length;
  });
  return { off, ids: Int32Array.from(ids) };
}

/** Per group: n and sum by universe (index g*2+u) and by universe-half (g*4+u*2+h). */
export interface Sums { n: Float64Array; s: Float64Array; nh: Float64Array; sh: Float64Array }

export function groupSums(recs: readonly Rec[], m: { off: Int32Array; ids: Int32Array }, G: number, edges: ArrayLike<number>): Sums {
  const out: Sums = { n: new Float64Array(G * 2), s: new Float64Array(G * 2), nh: new Float64Array(G * 4), sh: new Float64Array(G * 4) };
  for (let r = 0; r < recs.length; r++) {
    const { u, h } = recs[r], e = edges[r];
    for (let k = m.off[r]; k < m.off[r + 1]; k++) {
      const g = m.ids[k];
      out.n[g * 2 + u]++; out.s[g * 2 + u] += e;
      out.nh[g * 4 + u * 2 + h]++; out.sh[g * 4 + u * 2 + h] += e;
    }
  }
  return out;
}

export interface GroupStat { n: [number, number]; mean: [number, number]; halfN: [number, number]; halfMean: [number, number]; coreHalfMean: [number, number] }

const div = (a: number, b: number): number => (b > 0 ? a / b : NaN);

export function statOf(x: Sums, g: number): GroupStat {
  return {
    n: [x.n[g * 2], x.n[g * 2 + 1]],
    mean: [div(x.s[g * 2], x.n[g * 2]), div(x.s[g * 2 + 1], x.n[g * 2 + 1])],
    halfN: [x.nh[g * 4], x.nh[g * 4 + 1]],
    halfMean: [div(x.sh[g * 4], x.nh[g * 4]), div(x.sh[g * 4 + 1], x.nh[g * 4 + 1])],
    coreHalfMean: [div(x.sh[g * 4 + 2], x.nh[g * 4 + 2]), div(x.sh[g * 4 + 3], x.nh[g * 4 + 3])],
  };
}

export interface FlagRule { minMomN: number; minMomEdge: number; minCoreN: number }
export const FLAG: FlagRule = { minMomN: 50, minMomEdge: 14, minCoreN: 0 };

/** >= minMomN on Momentum, Momentum mean >= minMomEdge, Core mean > 0 (same sign) on >= max(1, minCoreN) trades, both Momentum halves >= 0. */
export function flagged(st: GroupStat, r: FlagRule = FLAG): boolean {
  return st.n[0] >= r.minMomN && st.mean[0] >= r.minMomEdge
    && st.n[1] >= Math.max(1, r.minCoreN) && st.mean[1] > 0
    && st.halfN[0] > 0 && st.halfN[1] > 0 && st.halfMean[0] >= 0 && st.halfMean[1] >= 0;
}

/**
 * Feature strength = spread (max - min) of Momentum bin means over bins with >= minN Momentum records.
 * Returns feature indices, strongest first.
 */
export function rankFeatures(x: Sums, groups: readonly Group[], F: number, minN = 30): { order: number[]; spread: number[] } {
  const lo = new Array(F).fill(Infinity), hi = new Array(F).fill(-Infinity);
  groups.forEach((g, i) => {
    if (g.length !== 1) return;
    const n = x.n[i * 2];
    if (n < minN) return;
    const m = x.s[i * 2] / n, f = g[0][0];
    lo[f] = Math.min(lo[f], m); hi[f] = Math.max(hi[f], m);
  });
  const spread = lo.map((l, f) => (Number.isFinite(l) && hi[f] > l ? hi[f] - l : 0));
  const order = [...spread.keys()].sort((a, b) => spread[b] - spread[a]);
  return { order, spread };
}

/** The groups actually tested: all singles and pairs, plus triples whose 3 features are all in `top`. */
export function testedMask(groups: readonly Group[], top: readonly number[]): Uint8Array {
  const t = new Set(top);
  return Uint8Array.from(groups.map((g) => (g.length < 3 || g.every(([f]) => t.has(f)) ? 1 : 0)));
}

/** Small deterministic PRNG (mulberry32) so the nulls are reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Label shuffle: edges permuted at random among records of the same universe. */
export function shuffleWithin(recs: readonly Rec[], edges: readonly number[], rand: () => number): Float64Array {
  const out = Float64Array.from(edges);
  for (const u of [0, 1]) {
    const pos: number[] = [];
    recs.forEach((r, i) => { if (r.u === u) pos.push(i); });
    for (let k = pos.length - 1; k > 0; k--) {
      const j = Math.floor(rand() * (k + 1));
      const a = pos[k], b = pos[j];
      const t = out[a]; out[a] = out[b]; out[b] = t;
    }
  }
  return out;
}

/** Circular shift: within each universe (records in symbol-time order), edges rotate by a random offset. Keeps their autocorrelation. */
export function circularShiftWithin(recs: readonly Rec[], edges: readonly number[], rand: () => number): Float64Array {
  const out = Float64Array.from(edges);
  for (const u of [0, 1]) {
    const pos: number[] = [];
    recs.forEach((r, i) => { if (r.u === u) pos.push(i); });
    const L = pos.length;
    if (L < 2) continue;
    const k = 1 + Math.floor(rand() * (L - 1));
    for (let i = 0; i < L; i++) out[pos[i]] = edges[pos[(i + k) % L]];
  }
  return out;
}

export function quantile(xs: readonly number[], p: number): number {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const h = (v.length - 1) * p, lo = Math.floor(h);
  return v[lo] + (h - lo) * (v[Math.min(lo + 1, v.length - 1)] - v[lo]);
}
