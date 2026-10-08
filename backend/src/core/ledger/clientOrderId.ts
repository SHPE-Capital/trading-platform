/**
 * core/ledger/clientOrderId.ts
 *
 * The id we hand the broker with every order (Alpaca `client_order_id`, max 128
 * chars). It carries the run that sent the order, `<runId>:<intentId>`, so the
 * broker's own records say which run each order belongs to — a backfill never
 * has to guess. Orders sent before this format carry the bare intent id.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function buildClientOrderId(intentId: string, runId?: string | null): string {
  return runId ? `${runId}:${intentId}` : intentId;
}

export interface ParsedClientOrderId {
  /** The run that sent the order, when the id says so. */
  runId: string | null;
  /** Our order id (the intent id) — the part after the run id, or the whole id. */
  intentId: string;
}

export function parseClientOrderId(raw: string): ParsedClientOrderId {
  const sep = raw.indexOf(":");
  if (sep > 0) {
    const runId = raw.slice(0, sep);
    const intentId = raw.slice(sep + 1);
    if (isUuid(runId) && intentId) return { runId, intentId };
  }
  return { runId: null, intentId: raw };
}
