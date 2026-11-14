/**
 * Golden parity test (P1-6): replays the research golden scenarios
 * (momentum_golden.v1, see fixtures/momentumGolden/SOURCE.md) through the
 * MomentumIndicatorBank and compares per-bar indicators (per-column tolerances
 * from each manifest), readiness, component signals and the final signal
 * exactly, then the signals file. Paper deployment is not allowed until this
 * passes. Tolerances and fixtures must never be loosened to make it pass.
 */

import fs from 'node:fs';
import path from 'node:path';
import { MomentumIndicatorBank } from '../../strategies/momentum/breakoutMomentumIndicators';
import { createBreakoutMomentumConfig, resolveBreakoutParams } from '../../strategies/momentum/breakoutMomentumConfig';
import { allocateBatch, median, type BatchCandidate } from '../../strategies/momentum/batchAllocator';
import type { EntryIntent } from '../../strategies/momentum/breakoutMomentumTypes';
import { parseWeeklyConfig } from '../../strategies/momentum/weeklyConfigLoader';
import type { BreakoutParams } from '../../strategies/momentum/breakoutMomentumTypes';

const ROOT = path.join(__dirname, 'fixtures', 'momentumGolden');
const SCENARIOS = ['s1_trend_gap', 's2_rvol_vwap', 's3_rank_size'];
const OPEN_MINUTE = 9 * 60 + 30;

type Row = Record<string, any>;
interface ColumnSpec { kind: 'number' | 'bool'; abs?: number; rel?: number }

function readJson(scenario: string, file: string): any {
  return JSON.parse(fs.readFileSync(path.join(ROOT, scenario, file), 'utf8'));
}
function readJsonl(scenario: string, file: string): Row[] {
  return fs.readFileSync(path.join(ROOT, scenario, file), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
}

/** Maps a bank step to the golden column names. ready_atr14 is not exposed by the bank (see replay). */
function actualColumns(step: ReturnType<MomentumIndicatorBank['update']>, params: BreakoutParams): Row {
  const { indicators: x, components: c } = step;
  const out: Row = {
    atr14: x.atr,
    [`prec_high_n${params.breakout.n}`]: x.precedingHigh,
    sig_breakout: c.breakout?.pass,
    [`ready_breakout_n${params.breakout.n}`]: c.breakout?.ready,
    signal: step.signal,
  };
  if (params.adx) {
    const a = params.adx.period;
    Object.assign(out, { [`adx_a${a}`]: x.adx, [`pdi_a${a}`]: x.plusDi, [`mdi_a${a}`]: x.minusDi, sig_adx: c.adx?.pass, [`ready_adx_a${a}`]: c.adx?.ready });
  }
  if (params.ema) {
    const { fast, slow } = params.ema;
    Object.assign(out, { [`ema_${fast}`]: x.emaFast, [`ema_${slow}`]: x.emaSlow, sig_ema: c.ema?.pass, [`ready_ema_f${fast}_s${slow}`]: c.ema?.ready });
  }
  if (params.rvol) Object.assign(out, { [`rvol_w${params.rvol.w}`]: x.rvol, sig_rvol: c.rvol?.pass, [`ready_rvol_w${params.rvol.w}`]: c.rvol?.ready });
  if (params.vwap) Object.assign(out, { vwap: x.vwap, sig_vwap: c.vwap?.pass, ready_vwap: c.vwap?.ready });
  return out;
}

function readyColumn(sigCol: string, params: BreakoutParams): string {
  switch (sigCol) {
    case 'sig_adx': return `ready_adx_a${params.adx!.period}`;
    case 'sig_ema': return `ready_ema_f${params.ema!.fast}_s${params.ema!.slow}`;
    case 'sig_rvol': return `ready_rvol_w${params.rvol!.w}`;
    default: return 'ready_vwap';
  }
}

function numberMatches(actual: number, expected: number | null, spec: ColumnSpec): boolean {
  if (expected === null) return Number.isNaN(actual);
  if (!Number.isFinite(actual)) return false;
  return Math.abs(actual - expected) <= (spec.abs ?? 0) + (spec.rel ?? 0) * Math.abs(expected);
}

function replay(scenario: string) {
  const manifest = readJson(scenario, 'manifest.json');
  const parsed = parseWeeklyConfig(readJson(scenario, 'weekly_config.json'));
  if (!parsed.ok) throw new Error(`fixture weekly config rejected: ${JSON.stringify(parsed)}`);
  const resolved = resolveBreakoutParams(parsed.config.selected!);
  if (!resolved.ok) throw new Error(resolved.reason);
  const params = resolved.params;
  const settings = createBreakoutMomentumConfig().signals;

  const bars = readJsonl(scenario, 'bars.jsonl');
  const expectedRows = readJsonl(scenario, 'indicators.jsonl');
  const sessionDate: string[] = manifest.sessions.map((s: any) => s.date);
  const missing = new Set<string>(manifest.missing_bars.map((m: any) => `${m.asset_id}:${m.i}`));
  const barAt = new Map<string, Row>(bars.map((b) => [`${b.asset_id}:${b.i}`, b]));
  const assets: string[] = manifest.symbols.map((s: any) => s.asset_id);
  const banks = new Map(assets.map((a) => [a, new MomentumIndicatorBank(params, settings)]));

  const mismatches: string[] = [];
  const actualSignals = new Set<string>();
  const signalInfo = new Map<string, { atr: number; close: number }>();
  let compared = 0;
  const cols: Record<string, ColumnSpec> = manifest.indicator_columns;
  for (const row of expectedRows) {
    const key = `${row.asset_id}:${row.i}`;
    if (missing.has(key)) {
      // A missing minute is NaN input; the bank is not fed (its next bar sees a time gap) and the golden row
      // must be all NaN / false.
      for (const [col, spec] of Object.entries(cols)) {
        // prec_high looks only at preceding bars, so research keeps it finite on the missing minute itself.
        if (col.startsWith('prec_high_n')) continue;
        const ok = spec.kind === 'number' ? row[col] === null : row[col] === false;
        if (!ok) mismatches.push(`${key} missing-bar ${col}: expected ${row[col]}`);
      }
      continue;
    }
    const b = barAt.get(key);
    if (!b) throw new Error(`no bar for ${key}`);
    const step = banks.get(row.asset_id)!.update({
      high: b.h, low: b.l, close: b.c, volume: b.v,
      ts: Date.parse(b.ts), sessionId: sessionDate[b.session], minuteOfDay: OPEN_MINUTE + b.minute,
    });
    const actual = actualColumns(step, params);
    for (const [col, spec] of Object.entries(cols)) {
      // The bank does not expose ready_atr14; it is covered through ready_breakout (prec_high finite AND ready_atr14).
      if (col === 'ready_atr14') continue;
      const a = actual[col];
      const e = row[col];
      // Research's sig_* is the raw component condition; the bank reports pass=false for a component that is
      // not ready (BankStep contract). The two only differ where ready is false, which never reaches a decision,
      // so sig_* is exact where ready and must be false where not; `signal` is compared exactly everywhere.
      const readyCol = col === 'sig_breakout' ? `ready_breakout_n${params.breakout.n}` : col.startsWith('sig_') ? readyColumn(col, params) : null;
      const ok = readyCol && actual[readyCol] === false ? a === false : spec.kind === 'bool' ? a === e : numberMatches(a, e, spec);
      if (!ok) mismatches.push(`${key} (s${b.session} m${b.minute}) col=${col}: actual ${a} expected ${e}`);
    }
    if (actual.signal !== row.signal) mismatches.push(`${key} col=signal: actual ${actual.signal} expected ${row.signal}`);
    if (step.signal) {
      actualSignals.add(key);
      signalInfo.set(key, { atr: step.indicators.atr, close: b.c });
    }
    compared += 1;
  }
  return { manifest, mismatches, actualSignals, compared, signalInfo, account: parsed.config.account, bars, assets };
}

function summarize(mismatches: string[]): string {
  const byCol = new Map<string, string[]>();
  for (const m of mismatches) {
    const col = /col=(\w+)|missing-bar (\w+)/.exec(m);
    const name = col ? (col[1] ?? col[2]) : 'other';
    byCol.set(name, [...(byCol.get(name) ?? []), m]);
  }
  return [...byCol].map(([c, l]) => `${c} x${l.length}, first: ${l.slice(0, 3).join(' | ')}`).join('\n');
}

describe('breakout momentum golden parity (indicators and signals)', () => {
  for (const scenario of SCENARIOS) {
    describe(scenario, () => {
      const result = replay(scenario);

      it('uses the supported fixture format and replays every present bar', () => {
        expect(result.manifest.format_version).toBe('momentum_golden.v1');
        expect(result.compared).toBe(result.manifest.counts.indicator_rows - result.manifest.missing_bars.length);
      });

      it('matches indicators, readiness, component signals and the final signal per bar', () => {
        expect(summarize(result.mismatches)).toBe('');
      });

      it('emits exactly the golden entry signals', () => {
        const expected = new Set(readJsonl(scenario, 'signals.jsonl').map((r) => `${r.asset_id}:${r.i}`));
        expect([...result.actualSignals].sort()).toEqual([...expected].sort());
      });
    });
  }
});

function near(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) <= 1e-9 + 1e-9 * Math.abs(expected);
}

/** Replays orders.jsonl through allocateBatch; liquidity inputs are derived from bars per momentum_golden.md. */
function replayOrders(scenario: string): string[] {
  const r = replay(scenario);
  const { manifest, account, bars } = r;
  const sessions: { start_i: number; n_minutes: number }[] = manifest.sessions;
  const symbolOf = new Map<string, string>(manifest.symbols.map((x: any) => [x.asset_id, x.symbol]));
  const barAt = new Map<string, Row>(bars.map((b) => [`${b.asset_id}:${b.i}`, b]));
  const dollarVolume = (asset: string, sess: number): number => {
    let sum = 0;
    for (let m = 0; m < sessions[sess].n_minutes; m += 1) {
      const b = barAt.get(`${asset}:${sessions[sess].start_i + m}`);
      if (b) sum += b.c * b.v;
    }
    return sum;
  };
  const lookback = account.liquidity_lookback;
  const problems: string[] = [];

  for (const d of readJsonl(scenario, 'orders.jsonl')) {
    const tag = `decision ${d.decision} (i=${d.i})`;
    const prev: number[] = [];
    for (let k = Math.max(0, d.session - lookback); k < d.session; k += 1) prev.push(k);
    const mine = [...r.signalInfo.keys()].filter((k) => k.endsWith(`:${d.i}`)).map((k) => k.split(':')[0]).sort();
    if (JSON.stringify(mine) !== JSON.stringify([...d.signals].sort())) {
      problems.push(`${tag} signals: actual ${mine} expected ${d.signals}`);
      continue;
    }
    const candidates: BatchCandidate[] = d.signals.map((asset: string) => {
      const info = r.signalInfo.get(`${asset}:${d.i}`)!;
      const volumes: number[] = [];
      for (const k of prev) {
        if (sessions[k].n_minutes < d.minute + 1) continue;
        const b = barAt.get(`${asset}:${sessions[k].start_i + d.minute}`);
        if (b) volumes.push(b.v);
      }
      const intent = {
        symbol: symbolOf.get(asset), assetId: asset, referenceClose: info.close, atr: info.atr,
      } as EntryIntent;
      return {
        intent,
        dollarVolumeMedian: d.session === 0 ? 0 : median(prev.map((k) => dollarVolume(asset, k))),
        sameMinuteVolumes: volumes,
      };
    });
    for (const c of candidates) {
      const e = d.dollar_volume_median[c.intent.assetId];
      // Golden scores only the candidates left after the entered-today filter.
      if (e === undefined && d.state.entered_today.includes(c.intent.assetId)) continue;
      if (e === undefined || !near(c.dollarVolumeMedian, e)) problems.push(`${tag} dollar_volume_median ${c.intent.assetId}: actual ${c.dollarVolumeMedian} expected ${e}`);
    }
    const st = d.state;
    const out = allocateBatch(candidates, {
      equity: st.equity, cashFree: st.cash_free, exposureUsed: st.exposure_used, openPositions: st.open_positions,
      pendingOrders: st.pending_orders, enteredToday: new Set<string>(st.entered_today),
    }, account);
    if (JSON.stringify(out.candidates) !== JSON.stringify(d.candidates)) problems.push(`${tag} candidates: actual ${out.candidates} expected ${d.candidates}`);
    const actRej = out.rejections.map((x) => `${x.assetId}:${x.reason}`);
    const expRej = d.rejections.map((x: any) => `${x.asset_id}:${x.reason}`);
    if (JSON.stringify(actRej) !== JSON.stringify(expRej)) problems.push(`${tag} rejections: actual ${actRej} expected ${expRej}`);
    if (out.orders.length !== d.orders.length) {
      problems.push(`${tag} order count: actual ${out.orders.length} expected ${d.orders.length}`);
      continue;
    }
    out.orders.forEach((o, n) => {
      const e = d.orders[n];
      if (o.assetId !== e.asset_id || o.rank !== e.rank || o.qty !== e.qty || o.bindingCap !== e.binding_cap) {
        problems.push(`${tag} order ${n}: actual ${o.assetId}/${o.rank}/${o.qty}/${o.bindingCap} expected ${e.asset_id}/${e.rank}/${e.qty}/${e.binding_cap}`);
      }
      const pairs: [string, number, number][] = [
        ['signal_close', o.signalClose, e.signal_close], ['atr', o.atr, e.atr], ['stop_distance', o.stopDistance, e.stop_distance],
        ['limit_price', o.limitPrice, e.limit_price], ['unit_cost', o.unitCost, e.unit_cost], // Golden `reserved` is this order's own qty*unit_cost; the allocator reports the batch's cumulative reserve.
        ['reserved', o.reserved - (n > 0 ? out.orders[n - 1].reserved : 0), e.reserved],
        ['liquidity_shares', o.liquidityShares, e.liquidity_shares],
      ];
      for (const [name, a, x] of pairs) if (!near(a, x)) problems.push(`${tag} order ${n} ${name}: actual ${a} expected ${x}`);
    });
  }
  return problems;
}

describe('breakout momentum golden parity (ranked and sized orders)', () => {
  for (const scenario of SCENARIOS) {
    it(`${scenario}: allocateBatch reproduces every golden decision`, () => {
      const decisions = readJsonl(scenario, 'orders.jsonl').length;
      expect(decisions).toBe(readJson(scenario, 'manifest.json').counts.decisions);
      expect(replayOrders(scenario).slice(0, 10)).toEqual([]);
    });
  }
});
