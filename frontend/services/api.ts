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
import { getAccessToken } from "../lib/supabaseClient";

/**
 * Builds request headers, attaching the Supabase access token when the member
 * is signed in. Read fresh per call so a background token refresh is picked up
 * without the caller knowing one happened.
 */
async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = await getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/**
 * Makes an authenticated GET request to the backend API.
 * @param path - API path (e.g. "/portfolio/snapshot")
 * @param baseUrl - Override the API host. Defaults to the trading runtime;
 *                  backtest calls pass config.backtestApiBaseUrl instead.
 * @returns Parsed JSON response
 */
export async function apiGet<T>(path: string, baseUrl: string = config.apiBaseUrl): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: await authHeaders(),
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
    headers: await authHeaders(),
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
    headers: await authHeaders(),
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
    headers: await authHeaders(),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((errBody as { error?: string }).error ?? `API error ${res.status}`);
  }
  return res.json() as Promise<T>;
}
