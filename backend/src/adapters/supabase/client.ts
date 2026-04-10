/**
 * adapters/supabase/client.ts
 *
 * Initializes and exports the Supabase client singleton used by all
 * repository modules. Uses the service role key for backend operations
 * (bypasses row-level security where needed).
 *
 * Inputs:  env.supabaseUrl, env.supabaseServiceRoleKey
 * Outputs: Supabase SupabaseClient instance
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { env } from "../../config/env";
import { logger } from "../../utils/logger";

let _client: SupabaseClient | null = null;

/**
 * Returns the initialized Supabase client singleton.
 * Lazily initialized on first call.
 * @returns SupabaseClient instance
 */
export function getSupabaseClient(): SupabaseClient {
  if (_client) return _client;
  _client = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false },
  });
  logger.info("Supabase client initialized", { url: env.supabaseUrl });
  return _client;
}
