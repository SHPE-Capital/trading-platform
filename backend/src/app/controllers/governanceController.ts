/**
 * app/controllers/governanceController.ts
 *
 * Shared-book governance views (Part 06). The contention summary answers the
 * question direct P&L cannot: whose strategy was blocked, how often, and by
 * which check — so capital contention is a number a member can act on rather
 * than an invisible reason their strategy looked unlucky.
 */

import type { Request, Response } from "express";
import { getContentionSummary } from "../../adapters/supabase/riskRejectionRepository";
import { logger } from "../../utils/logger";

const MAX_DAYS = 90;

/**
 * GET /api/governance/contention?days=7
 * Rejection counts per member, strategy, and failed check over the window.
 */
export async function getContention(req: Request, res: Response): Promise<void> {
  const raw = req.query.days === undefined ? 7 : Number(req.query.days);
  if (!Number.isInteger(raw) || raw < 1 || raw > MAX_DAYS) {
    res.status(400).json({ error: `days must be a whole number from 1 to ${MAX_DAYS}` });
    return;
  }
  try {
    const rows = await getContentionSummary(raw);
    res.json({ days: raw, rows });
  } catch (err) {
    logger.error("getContention error", { err });
    res.status(500).json({ error: "Failed to load contention summary" });
  }
}
