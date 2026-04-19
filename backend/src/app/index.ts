/**
 * app/index.ts
 *
 * Express application factory. Creates and configures the Express app
 * with all middleware, routes, and error handlers. Exported as a factory
 * so it can be imported by server.ts and used in tests without side effects.
 *
 * Inputs:  N/A — no inputs; reads env via config/env.ts.
 * Outputs: Configured Express Application instance.
 */

import express from "express";
import cors from "cors";
import { env } from "../config/env";
import { requestLogger } from "./middleware/requestLogger";
import { errorHandler } from "./middleware/errorHandler";
import apiRoutes from "./routes/index";
import type { AppContext } from "./context";

export function createApp(ctx: AppContext = {}): express.Application {
  const app = express();
  app.locals.ctx = ctx;

  // ------ Core middleware ------
  app.use(cors({ origin: env.corsOrigin }));
  app.use(express.json());
  app.use(requestLogger);

  // ------ API routes ------
  app.use("/api", apiRoutes);

  // ------ Convenience health check at root ------
  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  // ------ 404 handler ------
  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  // ------ Global error handler (must be last) ------
  app.use(errorHandler);

  return app;
}
