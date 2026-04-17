/**
 * services/systemService.ts
 *
 * Service for system health and status API calls.
 */

import { apiGet } from "./api";
import type { SystemStatus } from "../types/api";

export async function fetchSystemStatus(): Promise<SystemStatus> {
  return apiGet<SystemStatus>("/system/status");
}
