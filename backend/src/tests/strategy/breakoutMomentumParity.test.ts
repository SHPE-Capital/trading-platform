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
    if (step.signal) actualSignals.add(key);
    compared += 1;
  }
  return { manifest, mismatches, actualSignals, compared };
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

describe('breakout momentum golden parity (ranked and sized orders)', () => {
  it.todo('orders.jsonl: pending P1-4 allocator (strategies/momentum/batchAllocator.ts) and P1-5 sizer');
});
