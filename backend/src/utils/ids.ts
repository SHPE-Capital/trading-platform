/**
 * utils/ids.ts
 *
 * Unique identifier generation helpers. Uses UUID v4 for all IDs.
 * Centralizing ID generation makes it easy to swap implementations later.
 *
 * Inputs:  N/A
 * Outputs: UUID v4 string identifiers
 */

import { v4 as uuidv4 } from "uuid";
import { randomBytes } from "crypto";
import type { UUID } from "../types/common";

/**
 * Generates a new UUID v4 identifier.
 * @returns A new UUID v4 string
 */
export function newId(): UUID {
  return uuidv4();
}

const EVENT_ID_PREFIX = `ev-${randomBytes(4).toString("hex")}-`;
let eventSeq = 0;

/**
 * A process-unique id for high-volume, never-persisted events (market data).
 * About 10x cheaper than a UUID; not a UUID, so never store it in a uuid column.
 * @returns e.g. "ev-3fa2c1d0-1234"
 */
export function newEventId(): string {
  return EVENT_ID_PREFIX + (++eventSeq);
}

/**
 * Generates a prefixed identifier for readability in logs.
 * e.g. newPrefixedId("order") → "order_3f2504e0-4f89-..."
 * @param prefix - Short prefix label
 * @returns Prefixed UUID string
 */
export function newPrefixedId(prefix: string): string {
  return `${prefix}_${uuidv4()}`;
}
