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
  const allowedOrigins = env.corsOrigin.split(",").map((origin) => origin.trim()).filter(Boolean);
  app.use(cors({
    origin(origin, callback) {
      // Requests without Origin are server-to-server/health checks. Configured
      // entries may be exact URLs or a single-label wildcard such as
      // https://*.vercel.app for preview deployments.
      if (!origin) return callback(null, true);
      const allowed = allowedOrigins.some((pattern) => {
        if (pattern === origin) return true;
        if (!pattern.includes("*")) return false;
        const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace("*", "[^./]+");
        return new RegExp(`^${escaped}$`).test(origin);
      });
      callback(allowed ? null : new Error(`Origin ${origin} is not allowed by CORS`), allowed);
    },
  }));
  app.use(express.json());
  // Express 5 leaves req.body undefined on a body-less request; handlers
  // destructure it, so default to {} and let their own validation answer 400.
  app.use((req, _res, next) => {
    if (req.body === undefined) req.body = {};
    next();
  });
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
