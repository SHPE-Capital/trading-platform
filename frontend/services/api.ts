/**
 * services/api.ts
 *
 * Base HTTP client for all backend API calls.
 * Wraps fetch with base URL configuration, JSON parsing,
 * and consistent error handling.
 *
 * All other service modules call this instead of raw fetch.
 */

import { config } from "../config";

/**
 * Makes an authenticated GET request to the backend API.
 * @param path - API path (e.g. "/portfolio/snapshot")
 * @param baseUrl - Override the API host. Defaults to the trading runtime;
 *                  backtest calls pass config.backtestApiBaseUrl instead.
 * @returns Parsed JSON response
 */
export async function apiGet<T>(path: string, baseUrl: string = config.apiBaseUrl): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((body as { error?: string }).error ?? `API error ${res.status}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Makes an authenticated POST request to the backend API.
 * @param path - API path
 * @param body - Request body (will be JSON-serialized)
 * @param baseUrl - Override the API host. Defaults to the trading runtime;
 *                  backtest calls pass config.backtestApiBaseUrl instead.
 * @returns Parsed JSON response
 */
export async function apiPost<T>(
  path: string,
  body: unknown,
  baseUrl: string = config.apiBaseUrl,
): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((errBody as { error?: string }).error ?? `API error ${res.status}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Makes an authenticated PUT request to the backend API.
 * @param path - API path
 * @param body - Request body (will be JSON-serialized)
 * @returns Parsed JSON response
 */
export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${config.apiBaseUrl}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((errBody as { error?: string }).error ?? `API error ${res.status}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Makes an authenticated DELETE request to the backend API.
 * @param path - API path
 * @returns Parsed JSON response
 */
export async function apiDelete<T>(path: string): Promise<T> {
  const res = await fetch(`${config.apiBaseUrl}${path}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((errBody as { error?: string }).error ?? `API error ${res.status}`);
  }
  return res.json() as Promise<T>;
}
