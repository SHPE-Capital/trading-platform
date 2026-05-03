/**
 * app/middleware/requestLogger.ts
 *
 * HTTP request/response logging middleware.
 * Logs method, path, status code, and duration for every request.
 *
 * Inputs:  Every HTTP request passing through the Express app.
 * Outputs: Structured log lines via the logger utility.
 */

import type { Request, Response, NextFunction } from "express";
import { logger } from "../../utils/logger";

/**
 * Express middleware that logs each incoming request and its response status/duration.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  // Snapshot before Express mutates req.url as the request descends into sub-routers.
  // req.path would show only the sub-router-relative suffix by the time 'finish' fires.
  const path = req.originalUrl.split("?")[0];

  res.on("finish", () => {
    const durationMs = Date.now() - start;
    logger.info("HTTP", {
      method: req.method,
      path,
      status: res.statusCode,
      durationMs,
    });
  });

  next();
}
