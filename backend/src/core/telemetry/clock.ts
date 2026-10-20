/**
 * core/telemetry/clock.ts
 *
 * The two clocks a latency measurement needs, kept apart on purpose.
 *
 *   - Monotonic: process.hrtime.bigint(), nanoseconds since an arbitrary point
 *     in THIS process. Only differences are meaningful, and only between two
 *     readings from the same process. Every duration the benchmark reports is
 *     a difference of two monotonic readings.
 *   - Wall: Date.now(), the real UTC clock at millisecond resolution. Used only
 *     to compare local observation with a provider's event timestamp, a result
 *     that inherits the host's clock-synchronisation error.
 *
 * utils/time nowMs() is neither: a replay or backtest can override it with a
 * simulated clock, so it must never serve as the benchmark's stopwatch.
 *
 * Nanosecond epoch values do not fit a JavaScript Number exactly (2^53 ns is
 * about 104 days), so they stay bigint in memory and decimal strings in JSON.
 *
 * Inputs:  RFC-3339 provider timestamps; the process clocks.
 * Outputs: Monotonic stamps, epoch-ns values, durations with domain checks.
 */

import fs from "fs";
import os from "os";
import { randomBytes } from "crypto";

/** Reads the Linux boot id; elsewhere derives a stable label from uptime. */
function readBootId(): string {
  try {
    return fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
  } catch {
    // Rounded to 10 s so two processes on the same boot agree despite uptime jitter.
    const bootEpochS = Math.round((Date.now() - os.uptime() * 1000) / 10_000) * 10;
    return `derived-${bootEpochS}`;
  }
}

/** This host's boot identity. A different value means monotonic clocks restarted. */
export const BOOT_ID = readBootId();

/**
 * Identifies this process's monotonic clock. Two readings are subtractable
 * only when they carry the same domain id.
 */
export const CLOCK_DOMAIN_ID = `${os.hostname()}:${BOOT_ID}:${process.pid}:${randomBytes(3).toString("hex")}`;

/** Current monotonic time in nanoseconds (process-local, arbitrary origin). */
export function monoNs(): bigint {
  return process.hrtime.bigint();
}

/** Real wall-clock time in Unix ms. Deliberately not utils/time nowMs(). */
export function wallMs(): number {
  return Date.now();
}

/** A monotonic reading tagged with the clock it came from. */
export interface MonoStamp {
  domain: string;
  ns: bigint;
}

/** Stamps the current monotonic time in this process's clock domain. */
export function stampMono(): MonoStamp {
  return { domain: CLOCK_DOMAIN_ID, ns: process.hrtime.bigint() };
}

export class ClockDomainError extends Error {
  constructor(a: string, b: string) {
    super(`Refusing to subtract monotonic readings from different clock domains (${a} vs ${b})`);
    this.name = "ClockDomainError";
  }
}

/**
 * end − start in nanoseconds. Throws when the readings come from different
 * processes or boots: their origins are unrelated, so the difference is noise.
 */
export function durationNs(start: MonoStamp, end: MonoStamp): bigint {
  if (start.domain !== end.domain) throw new ClockDomainError(start.domain, end.domain);
  return end.ns - start.ns;
}

/** Converts nanoseconds to milliseconds for reporting only. */
export function nsToMs(ns: bigint | number): number {
  return Number(ns) / 1e6;
}

/** Unix ms → epoch nanoseconds, exactly. */
export function msToEpochNs(ms: number): bigint {
  return BigInt(Math.trunc(ms)) * 1_000_000n;
}

const RFC3339 =
  /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?([Zz]|[+-]\d{2}:\d{2})$/;

/**
 * An instant split so that every part is exact as a Number:
 * epochMs whole milliseconds plus subMsNs in [0, 1e6) nanoseconds.
 */
export interface Rfc3339Parts {
  epochMs: number;
  subMsNs: number;
}

// One-entry cache of the "YYYY-MM-DDTHH:MM:SS" prefix: consecutive provider
// timestamps almost always share their second.
let cachedPrefix = "";
let cachedPrefixMs = 0;

function digitsAt(s: string, start: number, len: number): number {
  let v = 0;
  for (let i = start; i < start + len; i++) {
    const d = s.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return -1;
    v = v * 10 + d;
  }
  return v;
}

/** Fast path for the UTC "…Z" form Alpaca sends; null means "use the general parser". */
function fastParts(iso: string): Rfc3339Parts | null | undefined {
  const n = iso.length;
  if (n < 20 || iso.charCodeAt(n - 1) !== 90 /* Z */ || iso.charCodeAt(10) !== 84 /* T */) return undefined;
  let baseMs: number;
  if (cachedPrefix.length === 19 && iso.startsWith(cachedPrefix)) {
    baseMs = cachedPrefixMs;
  } else {
    if (iso.charCodeAt(4) !== 45 || iso.charCodeAt(7) !== 45 || iso.charCodeAt(13) !== 58 || iso.charCodeAt(16) !== 58) return undefined;
    const year = digitsAt(iso, 0, 4), month = digitsAt(iso, 5, 2), day = digitsAt(iso, 8, 2);
    const hour = digitsAt(iso, 11, 2), minute = digitsAt(iso, 14, 2), second = digitsAt(iso, 17, 2);
    if (year < 0 || month < 1 || month > 12 || day < 1 || hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 60) {
      return null;
    }
    baseMs = Date.UTC(year, month - 1, day, hour, minute, second);
    if (new Date(Date.UTC(year, month - 1, day)).getUTCDate() !== day) return null;
    cachedPrefix = iso.slice(0, 19);
    cachedPrefixMs = baseMs;
  }
  if (n === 20) return { epochMs: baseMs, subMsNs: 0 };
  if (iso.charCodeAt(19) !== 46 /* . */ || n < 22) return undefined;
  const fracDigits = Math.min(n - 21, 9);
  const frac = digitsAt(iso, 20, fracDigits);
  if (frac < 0 || digitsAt(iso, 20, n - 21) < 0) return null;
  const fracNs = frac * 10 ** (9 - fracDigits);
  return { epochMs: baseMs + Math.floor(fracNs / 1e6), subMsNs: fracNs % 1e6 };
}

/**
 * Parses an RFC-3339 timestamp into exact millisecond + nanosecond parts,
 * without BigInt. Cheap enough for the per-event hot path.
 */
export function parseRfc3339Parts(iso: string): Rfc3339Parts | null {
  if (typeof iso !== "string") return null;
  const fast = fastParts(iso);
  if (fast !== undefined) return fast;
  const ns = parseRfc3339General(iso);
  if (ns === null) return null;
  const ms = ns / 1_000_000n;
  const rem = ns - ms * 1_000_000n;
  return rem < 0n
    ? { epochMs: Number(ms) - 1, subMsNs: Number(rem + 1_000_000n) }
    : { epochMs: Number(ms), subMsNs: Number(rem) };
}

/**
 * Parses an RFC-3339 timestamp to epoch nanoseconds without losing the
 * sub-millisecond digits Date.parse discards. Digits beyond the ninth are
 * truncated. Returns null for anything that is not a valid RFC-3339 instant.
 *
 * @example parseRfc3339ToEpochNs("2024-01-15T14:30:00.123456789Z") === 1705329000123456789n
 */
export function parseRfc3339ToEpochNs(iso: string): bigint | null {
  const p = parseRfc3339Parts(iso);
  return p === null ? null : BigInt(p.epochMs) * 1_000_000n + BigInt(p.subMsNs);
}

function parseRfc3339General(iso: string): bigint | null {
  const m = RFC3339.exec(iso);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, frac, zone] = m;
  const year = Number(y), month = Number(mo), day = Number(d);
  const hour = Number(h), minute = Number(mi), second = Number(s);
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 60) return null;
  const dayCheck = new Date(Date.UTC(year, month - 1, day));
  if (dayCheck.getUTCDate() !== day) return null; // e.g. 2024-02-30

  let offsetMinutes = 0;
  if (zone !== "Z" && zone !== "z") {
    const sign = zone[0] === "-" ? -1 : 1;
    const oh = Number(zone.slice(1, 3));
    const om = Number(zone.slice(4, 6));
    if (oh > 23 || om > 59) return null;
    offsetMinutes = sign * (oh * 60 + om);
  }

  const baseMs = Date.UTC(year, month - 1, day, hour, minute, second) - offsetMinutes * 60_000;
  const fracNs = frac ? BigInt((frac + "00000000").slice(0, 9)) : 0n;
  return BigInt(baseMs) * 1_000_000n + fracNs;
}

// Separate one-entry cache for rfc3339ToEpochMs, computed with Date itself so
// the result matches Date semantics exactly.
let msPrefix = "";
let msPrefixBase = Number.NaN;

/**
 * Exactly `new Date(iso).getTime()`, without Date parsing on the hot path.
 * Consecutive provider timestamps share their "YYYY-MM-DDTHH:MM:SS" second;
 * that prefix is parsed once with Date and cached, and the fraction is added
 * as Date does (truncated to milliseconds). Any other form falls back to Date.
 */
export function rfc3339ToEpochMs(iso: string): number {
  const n = iso.length;
  if (n < 20 || iso.charCodeAt(n - 1) !== 90 /* Z */ || iso.charCodeAt(10) !== 84 /* T */) return new Date(iso).getTime();
  if (msPrefix.length !== 19 || !iso.startsWith(msPrefix)) {
    msPrefix = iso.slice(0, 19);
    msPrefixBase = new Date(`${msPrefix}Z`).getTime();
  }
  if (Number.isNaN(msPrefixBase)) return new Date(iso).getTime();
  if (n === 20) return msPrefixBase;
  // More than 9 fractional digits: V8 reads them inconsistently, so defer to it.
  if (iso.charCodeAt(19) !== 46 /* . */ || n < 22 || n > 30) return new Date(iso).getTime();
  let ms = 0;
  for (let i = 20; i < n - 1; i++) {
    const d = iso.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return new Date(iso).getTime();
    if (i < 23) ms = ms * 10 + d;
  }
  const digits = Math.min(3, n - 21);
  return msPrefixBase + (digits === 3 ? ms : digits === 2 ? ms * 10 : ms * 100);
}
