/**
 * app/controllers/brokerController.ts
 *
 * The account as the broker reports it — the source of truth for equity, cash
 * and positions — plus the ledger's drift against it. Served by a trading
 * runtime (it holds the broker connection); reads are cached briefly to stay
 * well inside Alpaca's rate limit however many people have the dashboard open.
 */

import type { Request, Response } from "express";
import { sharedCache } from "../../utils/cache";
import { logger } from "../../utils/logger";
import type { AppContext } from "../context";

const ACCOUNT_TTL_MS = 15_000;
const HISTORY_TTL_MS = 60_000;
const PERIODS = new Set(["1D", "1W", "1M", "3M", "6M", "1A"]);
const TIMEFRAMES = new Set(["1Min", "5Min", "15Min", "1H", "1D"]);

function brokerOf(req: Request, res: Response) {
  const ctx = (req.app.locals.ctx ?? {}) as AppContext;
  if (!ctx.broker) {
    res.status(503).json({ error: "No broker connection in this process — ask a trading runtime" });
    return null;
  }
  return ctx;
}

/** GET /api/broker/account */
export async function getBrokerAccount(req: Request, res: Response): Promise<void> {
  const ctx = brokerOf(req, res);
  if (!ctx) return;
  try {
    const account = await sharedCache.getOrLoad(`broker:account:${ctx.broker!.accountId}`, ACCOUNT_TTL_MS, () => ctx.broker!.getAccount());
    res.json({ ...account, executionTarget: ctx.executionTarget ?? null });
  } catch (err) {
    logger.error("getBrokerAccount failed", { err: String(err) });
    res.status(502).json({ error: "Broker account unavailable" });
  }
}

/** GET /api/broker/positions */
export async function getBrokerPositions(req: Request, res: Response): Promise<void> {
  const ctx = brokerOf(req, res);
  if (!ctx) return;
  try {
    res.json(await sharedCache.getOrLoad(`broker:positions:${ctx.broker!.accountId}`, ACCOUNT_TTL_MS, () => ctx.broker!.getPositions()));
  } catch (err) {
    logger.error("getBrokerPositions failed", { err: String(err) });
    res.status(502).json({ error: "Broker positions unavailable" });
  }
}

/** GET /api/broker/history?period=1M&timeframe=1D */
export async function getBrokerHistory(req: Request, res: Response): Promise<void> {
  const ctx = brokerOf(req, res);
  if (!ctx) return;
  const period = String(req.query["period"] ?? "1M");
  const timeframe = String(req.query["timeframe"] ?? "1D");
  if (!PERIODS.has(period) || !TIMEFRAMES.has(timeframe)) {
    res.status(400).json({ error: `period must be one of ${[...PERIODS]}; timeframe one of ${[...TIMEFRAMES]}` });
    return;
  }
  try {
    res.json(await sharedCache.getOrLoad(`broker:history:${ctx.broker!.accountId}:${period}:${timeframe}`, HISTORY_TTL_MS,
      () => ctx.broker!.getPortfolioHistory(period, timeframe)));
  } catch (err) {
    logger.error("getBrokerHistory failed", { err: String(err) });
    res.status(502).json({ error: "Broker history unavailable" });
  }
}

/** GET /api/broker/drift — positions not held by a running run (alert only) */
export async function getBrokerDrift(req: Request, res: Response): Promise<void> {
  const ctx = brokerOf(req, res);
  if (!ctx) return;
  try {
    res.json({ brokerAccount: ctx.broker!.accountId, rows: await ctx.ledgerStore!.readDrift(ctx.broker!.accountId) });
  } catch (err) {
    logger.error("getBrokerDrift failed", { err: String(err) });
    res.status(500).json({ error: "Drift unavailable" });
  }
}
