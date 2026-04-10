/**
 * app/middleware/errorHandler.ts
 *
 * Global Express error-handling middleware. Catches unhandled errors thrown
 * in route handlers and returns a consistent JSON error response.
 * Must be registered last in the Express middleware chain.
 *
 * Inputs:  Error objects thrown or passed to next(err) in route handlers.
 * Outputs: JSON error response with status code and message.
 */

import type { Request, Response, NextFunction } from "express";
import { logger } from "../../utils/logger";

/**
 * Express error handler middleware.
 * Returns { error: string, statusCode: number } JSON to the client.
 */
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  logger.error("Unhandled error in route", {
    method: req.method,
    path: req.path,
    message: err.message,
    stack: err.stack,
  });

  const statusCode = (err as { statusCode?: number }).statusCode ?? 500;
  res.status(statusCode).json({
    error: err.message ?? "Internal server error",
    statusCode,
  });
}
