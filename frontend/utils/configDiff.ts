/**
 * utils/configDiff.ts
 *
 * Field-level diff between two strategy configs, for the review page's
 * "what changed in this version" view. Nested objects (riskBudget, ...) are
 * flattened to dotted paths so a one-field budget change shows as one row, not
 * as a whole changed object. Arrays compare as a unit — symbols: [A, B] → [A, C]
 * is one change, which is how a reviewer thinks about it.
 */

export type DiffKind = "changed" | "added" | "removed";

export interface ConfigDiffRow {
  path: string;
  kind: DiffKind;
  before: unknown;
  after: unknown;
}

export interface ConfigDiff {
  rows: ConfigDiffRow[];
  unchangedCount: number;
}

type Plain = Record<string, unknown>;

function isPlainObject(v: unknown): v is Plain {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** { a: { b: 1 }, c: [1] } → { "a.b": 1, "c": [1] } */
export function flattenConfig(config: Plain, prefix = ""): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const [key, value] of Object.entries(config)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(value) && Object.keys(value).length > 0) {
      for (const [p, v] of flattenConfig(value, path)) out.set(p, v);
    } else {
      out.set(path, value);
    }
  }
  return out;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Rows for every field that differs, in a stable order (by path). `before` may
 * be null for a first version, in which case nothing is reported as changed.
 */
export function diffConfigs(before: Plain | null, after: Plain): ConfigDiff {
  if (!before) return { rows: [], unchangedCount: flattenConfig(after).size };

  const a = flattenConfig(before);
  const b = flattenConfig(after);
  const paths = [...new Set([...a.keys(), ...b.keys()])].sort();

  const rows: ConfigDiffRow[] = [];
  let unchangedCount = 0;
  for (const path of paths) {
    const inA = a.has(path);
    const inB = b.has(path);
    if (inA && inB) {
      if (same(a.get(path), b.get(path))) unchangedCount++;
      else rows.push({ path, kind: "changed", before: a.get(path), after: b.get(path) });
    } else if (inB) {
      rows.push({ path, kind: "added", before: undefined, after: b.get(path) });
    } else {
      rows.push({ path, kind: "removed", before: a.get(path), after: undefined });
    }
  }
  return { rows, unchangedCount };
}

/**
 * Human-readable value for a config field. Durations are stored in ms and
 * fractions of the book as 0–1, which are easy to misread raw — a 604,800,000
 * window reads very differently as "7 days".
 */
export function formatConfigValue(path: string, value: unknown): string {
  if (value === undefined) return "—";
  if (typeof value === "number") {
    if (/Ms$/.test(path)) return `${value.toLocaleString()} ms (${describeMs(value)})`;
    if (/Pct$/.test(path) && value >= 0 && value <= 1) return `${(value * 100).toFixed(1)}%`;
    return value.toLocaleString();
  }
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function describeMs(ms: number): string {
  const mins = ms / 60_000;
  if (mins < 60) return `${+mins.toFixed(1)} min`;
  const hours = mins / 60;
  if (hours < 48) return `${+hours.toFixed(1)} h`;
  return `${+(hours / 24).toFixed(1)} days`;
}
