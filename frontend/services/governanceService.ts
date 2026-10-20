/**
 * services/governanceService.ts
 *
 * Shared-book governance views, read straight from Supabase (services/db.ts):
 * persisted rejections come from the trading runtimes, and members may read them.
 */

import { queryContention, type ContentionRow } from "./db";

export type { ContentionRow };

export interface ContentionSummary {
  days: number;
  rows: ContentionRow[];
}

const MAX_DAYS = 90;

export async function fetchContention(days: number): Promise<ContentionSummary> {
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
    throw new Error(`days must be a whole number from 1 to ${MAX_DAYS}`);
  }
  return { days, rows: await queryContention(days) };
}
