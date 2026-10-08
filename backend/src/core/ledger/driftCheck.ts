/**
 * core/ledger/driftCheck.ts
 *
 * Compares what the broker holds with what the ledger says each run holds, per
 * symbol. Two things are worth an alert:
 *
 *   - unattributed: the broker holds shares no run accounts for (an order from
 *     outside the platform, or history the ledger has not synced);
 *   - held by stopped runs: a run stopped without flattening, so the position
 *     sits in the book with nothing managing it.
 *
 * Alert only — nothing here blocks trading.
 */

export interface PositionQty {
  symbol: string;
  qty: number;
}

export interface RunPositionQty extends PositionQty {
  runId: string | null;
}

export interface DriftRow {
  symbol: string;
  brokerQty: number;
  runningQty: number;
  stoppedQty: number;
  unattributedQty: number;
}

const EPS = 1e-6;

export function computeDrift(
  brokerPositions: PositionQty[],
  runPositions: RunPositionQty[],
  runningRunIds: ReadonlySet<string>,
): DriftRow[] {
  const rows = new Map<string, DriftRow>();
  const row = (symbol: string): DriftRow => {
    let r = rows.get(symbol);
    if (!r) {
      r = { symbol, brokerQty: 0, runningQty: 0, stoppedQty: 0, unattributedQty: 0 };
      rows.set(symbol, r);
    }
    return r;
  };

  for (const p of brokerPositions) row(p.symbol).brokerQty += p.qty;
  for (const p of runPositions) {
    if (!p.runId) continue;
    const r = row(p.symbol);
    if (runningRunIds.has(p.runId)) r.runningQty += p.qty;
    else r.stoppedQty += p.qty;
  }

  const out: DriftRow[] = [];
  for (const r of rows.values()) {
    r.unattributedQty = r.brokerQty - r.runningQty - r.stoppedQty;
    for (const k of ["brokerQty", "runningQty", "stoppedQty", "unattributedQty"] as const) {
      if (Math.abs(r[k]) < EPS) r[k] = 0;
    }
    if (r.unattributedQty !== 0 || r.stoppedQty !== 0) out.push(r);
  }
  return out.sort((a, b) => a.symbol.localeCompare(b.symbol));
}

export interface DriftStore {
  runPositions(account: string): Promise<RunPositionQty[]>;
  runningRunIds(runIds: string[]): Promise<Set<string>>;
  replaceDrift(account: string, rows: DriftRow[], checkedAt: number): Promise<void>;
}

export async function checkDrift(
  account: string,
  brokerPositions: PositionQty[],
  store: DriftStore,
  now: () => number = Date.now,
): Promise<DriftRow[]> {
  const runPositions = await store.runPositions(account);
  const runIds = [...new Set(runPositions.map((p) => p.runId).filter((r): r is string => !!r))];
  const running = await store.runningRunIds(runIds);
  const rows = computeDrift(brokerPositions, runPositions, running);
  await store.replaceDrift(account, rows, now());
  return rows;
}
