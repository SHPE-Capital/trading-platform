/**
 * app/middleware/requireIngestToken.ts
 *
 * Backend-only auth for momentum artifact uploads. Calibration jobs send the
 * shared MOMENTUM_INGEST_TOKEN as a bearer token; there is no user session.
 * Fails closed: an unset token refuses every upload (503), a wrong one is 401.
 */

import { timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { env } from "../../config/env";

export function requireIngestToken(req: Request, res: Response, next: NextFunction): void {
  const expected = env.momentumIngestToken;
  if (!expected) {
    res.status(503).json({ error: "Momentum uploads are disabled (MOMENTUM_INGEST_TOKEN is not set)" });
    return;
  }
  const header = req.headers.authorization;
  const given = header && header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    res.status(401).json({ error: "Invalid upload token" });
    return;
  }
  next();
}
