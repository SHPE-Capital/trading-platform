/**
 * app/controllers/systemController.ts
 *
 * Controller for system-level endpoints: health check, engine status,
 * and kill-switch activation. These endpoints give the frontend visibility
 * into the backend's current operational state.
 */

import type { Request, Response } from "express";
import { getSupabaseClient } from "../../adapters/supabase/client";
import { env } from "../../config/env";
import { nowIso } from "../../utils/time";
import type { AppContext } from "../context";

type SystemHealthStatus = "healthy" | "degraded" | "unhealthy";
type ExecutionMode = "paper" | "live" | "backtest" | "replay";

interface ServiceHealth {
  health: boolean;
  error?: string;
  accountStatus?: string;
}

interface HealthResponse {
  status: SystemHealthStatus;
  services: {
    supabase: ServiceHealth;
    alpaca: ServiceHealth;
  };
  mode: ExecutionMode;
  /** Where this process sends orders, and the account it resolved at boot. */
  execution: { target: string | null; brokerAccount: string | null };
  build: { origin: string; sha: string; dirty: boolean };
  ts: string;
}

async function checkSupabase(): Promise<ServiceHealth> {
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase.from("backtest_results").select("id").limit(1);
    if (!error) return { health: true };

    const msg = error.message.toLowerCase();
    if (msg.includes("invalid api key") || msg.includes("apikey") || msg.includes("jwt")) {
      return { health: false, error: `[${error.code}] Invalid Supabase credentials` };
    }
    return { health: false, error: error.code ? `[${error.code}] ${error.message}` : error.message };
  } catch {
    return { health: false, error: "Cannot reach Supabase (network error)" };
  }
}

async function checkAlpaca(): Promise<ServiceHealth> {
  const base = env.alpacaTradingMode === "live" ? env.alpacaLiveBaseUrl : env.alpacaPaperBaseUrl;
  try {
    const res = await fetch(`${base}/v2/account`, {
      headers: {
        "APCA-API-KEY-ID": env.alpacaApiKey,
        "APCA-API-SECRET-KEY": env.alpacaApiSecret,
      },
    });

    if (res.ok) {
      const body = await res.json() as { status?: string };
      const accountStatus = body.status ?? "UNKNOWN";
      if (accountStatus !== "ACTIVE") {
        return { health: false, accountStatus, error: `Alpaca account status: ${accountStatus}` };
      }
      return { health: true, accountStatus };
    }

    switch (res.status) {
      case 401: return { health: false, error: "[401] Invalid Alpaca API key or secret" };
      case 403: return { health: false, error: "[403] Account forbidden or not authorized" };
      case 404: return { health: false, error: "[404] Account not found" };
      case 500: return { health: false, error: "[500] Alpaca internal server error" };
      default:  return { health: false, error: `[${res.status}] Alpaca API error` };
    }
  } catch {
    return { health: false, error: "Cannot reach Alpaca API (network error)" };
  }
}

/** GET /api/system/health */
export function healthCheck(_req: Request, res: Response): void {
  res.json({ status: "ok", ts: nowIso() });
}

/**
 * POST /api/system/kill-switch
 * Body: { enabled: boolean }
 * Activates or deactivates the risk engine kill switch, halting all new orders.
 */
export function setKillSwitch(req: Request, res: Response): void {
  const { enabled } = req.body as { enabled?: boolean };
  if (typeof enabled !== "boolean") {
    res.status(400).json({ error: "enabled (boolean) is required" });
    return;
  }
  const { riskEngine } = req.app.locals.ctx as AppContext;
  if (!riskEngine) {
    res.status(503).json({ error: "Risk engine not available in this runtime mode" });
    return;
  }
  riskEngine.setKillSwitch(enabled);
  res.json({ killSwitch: enabled });
}

/**
 * GET /api/system/status
 * Checks Supabase and Alpaca connectivity and returns per-service health details.
 */
export async function getSystemStatus(req: Request, res: Response): Promise<void> {
  const { executionTarget, brokerAccount } = (req.app?.locals?.ctx ?? {}) as AppContext;
  // A sim book, or a process with no trading keys, never talks to the broker.
  const brokerUnused = executionTarget === "sim" || !env.alpacaApiKey || !env.alpacaApiSecret;
  const [supabase, alpaca] = await Promise.all([
    checkSupabase(),
    brokerUnused ? Promise.resolve<ServiceHealth>({ health: true, accountStatus: "NOT_USED" }) : checkAlpaca(),
  ]);

  const healthyCount = [supabase.health, alpaca.health].filter(Boolean).length;
  let status: SystemHealthStatus;
  if (healthyCount === 2) status = "healthy";
  else if (healthyCount === 1) status = "degraded";
  else status = "unhealthy";

  const body: HealthResponse = {
    status,
    services: { supabase, alpaca },
    mode: env.alpacaTradingMode,
    execution: { target: executionTarget ?? null, brokerAccount: brokerAccount ?? null },
    build: { origin: env.runtimeOrigin, sha: env.buildSha, dirty: env.buildDirty },
    ts: nowIso(),
  };

  res.json(body);
}
