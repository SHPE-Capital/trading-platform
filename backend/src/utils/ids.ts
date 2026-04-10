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
import type { UUID } from "../types/common";

/**
 * Generates a new UUID v4 identifier.
 * @returns A new UUID v4 string
 */
export function newId(): UUID {
  return uuidv4();
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
