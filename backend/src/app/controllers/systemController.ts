/**
 * app/controllers/systemController.ts
 *
 * Controller for system-level endpoints: health check, engine status,
 * and kill-switch activation. These endpoints give the frontend visibility
 * into the backend's current operational state.
 *
 * Inputs:  HTTP requests from the frontend.
 * Outputs: JSON responses with system status information.
 */

import type { Request, Response } from "express";
import { getSupabaseClient } from "../../adapters/supabase/client";
import { env } from "../../config/env";
import { nowIso } from "../../utils/time";

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
  ts: string;
}

async function checkSupabase(): Promise<ServiceHealth> {
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase.from("backtest_results").select("id").limit(1);
    if (!error) return { health: true };

    const msg = error.message.toLowerCase();
    if (msg.includes("invalid api key") || msg.includes("apikey") || msg.includes("jwt")) {
      return { health: false, error: "Invalid Supabase credentials" };
    }
    return { health: false, error: error.message };
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
      case 401: return { health: false, error: "Invalid Alpaca API key or secret" };
      case 403: return { health: false, error: "Alpaca account forbidden or not authorized" };
      case 404: return { health: false, error: "Alpaca account not found" };
      default:  return { health: false, error: `Alpaca API error (HTTP ${res.status})` };
    }
  } catch {
    return { health: false, error: "Cannot reach Alpaca API (network error)" };
  }
}

/**
 * GET /api/system/health
 * Returns a simple health check response confirming the server is running.
 */
export function healthCheck(_req: Request, res: Response): void {
  res.json({ status: "ok", ts: nowIso() });
}

/**
 * GET /api/system/status
 * Checks Supabase and Alpaca connectivity and returns per-service health details.
 */
export async function getSystemStatus(_req: Request, res: Response): Promise<void> {
  const [supabase, alpaca] = await Promise.all([checkSupabase(), checkAlpaca()]);

  const healthyCount = [supabase.health, alpaca.health].filter(Boolean).length;
  let status: SystemHealthStatus;
  if (healthyCount === 2) status = "healthy";
  else if (healthyCount === 1) status = "degraded";
  else status = "unhealthy";

  const body: HealthResponse = {
    status,
    services: { supabase, alpaca },
    mode: env.alpacaTradingMode,
    ts: nowIso(),
  };

  res.json(body);
}
