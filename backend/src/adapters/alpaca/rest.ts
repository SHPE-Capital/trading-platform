/**
 * adapters/alpaca/rest.ts
 *
 * Minimal authenticated GET against the Alpaca trading REST API, shared by the
 * startup account check, the market clock, and the broker reads. Retries
 * rate-limit (429) and transient 5xx responses with backoff; anything else is
 * thrown with Alpaca's message so callers can report it.
 */

import { env } from "../../config/env";

export interface AlpacaCredentials {
  key: string;
  secret: string;
}

/** Trading API base URL for a paper or real-money account. */
export function alpacaTradingBaseUrl(kind: "paper" | "live"): string {
  return kind === "live" ? env.alpacaLiveBaseUrl : env.alpacaPaperBaseUrl;
}

const MAX_ATTEMPTS = 4;
const BACKOFF_BASE_MS = 500;

export async function alpacaGet<T>(
  baseUrl: string,
  path: string,
  creds: AlpacaCredentials,
  fetchImpl: typeof fetch = fetch,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetchImpl(`${baseUrl}${path}`, {
      headers: { "APCA-API-KEY-ID": creds.key, "APCA-API-SECRET-KEY": creds.secret },
    });
    if (res.ok) return (await res.json()) as T;
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= MAX_ATTEMPTS) {
      throw new Error(`Alpaca GET ${path} failed (${res.status}): ${await res.text()}`);
    }
    const retryAfter = Number(res.headers.get("retry-after"));
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : BACKOFF_BASE_MS * 2 ** (attempt - 1));
  }
}
