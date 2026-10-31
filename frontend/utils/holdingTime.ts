/**
 * utils/holdingTime.ts
 *
 * Shared helpers for the pairs-trading max-holding-time limit, so the strategy
 * form, the backtest form and the read-only displays agree on bounds and wording.
 */

/** One year in minutes. Larger values are almost always milliseconds typed into a minutes field. */
export const MAX_HOLDING_MINS = 527_040;

/** The strategy decides once per one-minute bar, so a shorter limit cannot be honoured. */
export const MIN_HOLDING_MINS = 1;

/** Renders a minutes count as a human-scale duration so mis-typed values stand out. */
export function describeMinutes(mins: number): string {
  if (!Number.isFinite(mins) || mins <= 0) return "—";
  if (mins < 60) return `${mins} min`;
  if (mins < 1_440) return `${(mins / 60).toFixed(1).replace(/\.0$/, "")} hours`;
  if (mins < 43_200) return `${(mins / 1_440).toFixed(1).replace(/\.0$/, "")} days`;
  return `${(mins / 43_200).toFixed(1).replace(/\.0$/, "")} months`;
}

/** Same as describeMinutes for a millisecond limit; "—" when the limit is missing. */
export function describeHoldingMs(ms: number | undefined): string {
  return ms === undefined ? "—" : describeMinutes(ms / 60_000);
}

/** Why a max-holding value in minutes is unusable, or null when it is fine. */
export function maxHoldingProblem(mins: number): string | null {
  if (!Number.isFinite(mins)) return "Max Holding Time must be a number.";
  if (!Number.isInteger(mins)) return "Max Holding Time must be a whole number of minutes.";
  if (mins < MIN_HOLDING_MINS) return `Max Holding Time must be at least ${MIN_HOLDING_MINS} minute.`;
  if (mins > MAX_HOLDING_MINS) {
    return `Max Holding Time of ${mins.toLocaleString()} minutes is about ${describeMinutes(mins)}. ` +
      `This field is in minutes, not milliseconds — the maximum is ${MAX_HOLDING_MINS.toLocaleString()} (1 year).`;
  }
  return null;
}

/** Caption for the max-holding field: what the limit does, so it is never implicit. */
export function maxHoldingHint(mins: number): string {
  return `${describeMinutes(mins)} — hard limit: the position is force-closed at this age, whatever the z-score`;
}

/** The pairs max-holding limit in a saved or run config; undefined for other strategies or when unset. */
export function pairsMaxHoldingMs(strategyType: string | undefined, config: Record<string, unknown> | undefined): number | undefined {
  if (strategyType !== "pairs_trading") return undefined;
  const ms = config?.maxHoldingTimeMs;
  return typeof ms === "number" && Number.isFinite(ms) ? ms : undefined;
}
