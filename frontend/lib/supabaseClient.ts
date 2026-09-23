/**
 * lib/supabaseClient.ts
 *
 * Browser-side Supabase client, used only for authentication — sign-in,
 * sign-out, and reading the current session's JWT.
 *
 * Deliberately NOT used to query tables directly. All data access goes through
 * the backend REST API, which holds the service-role key and enforces the
 * ownership and role rules. This client's job is to obtain the token that
 * services/api.ts attaches to those requests.
 *
 * Inputs:  NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY
 * Outputs: A singleton SupabaseClient, or null when auth is not configured.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/**
 * True when both env vars are present. When false the app runs in a
 * no-auth local mode: the login screen explains what to set rather than
 * failing with an opaque network error.
 */
export const isAuthConfigured = Boolean(url && anonKey);

let _client: SupabaseClient | null = null;

/** Returns the auth client singleton, or null when auth is not configured. */
export function getSupabase(): SupabaseClient | null {
  if (!isAuthConfigured) return null;
  if (!_client) {
    _client = createClient(url, anonKey, {
      auth: {
        // The session lives in localStorage and is refreshed in the background,
        // so a reload keeps the member signed in.
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return _client;
}

/**
 * Current access token, or null when signed out.
 * Read fresh on each API call rather than cached, so a background refresh is
 * picked up without the caller knowing a refresh happened.
 */
export async function getAccessToken(): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
