/**
 * services/authService.ts
 *
 * Identity calls against the backend. Sign-in itself happens client-side
 * against Supabase (see lib/supabaseClient.ts); this resolves the club profile
 * for the resulting token, which is where `role` comes from.
 */

import { apiGet } from "./api";
import type { AuthUser } from "../types/review";

/** The signed-in member's club profile. Throws 401 when the token is invalid. */
export async function fetchMe(): Promise<AuthUser> {
  return apiGet<AuthUser>("/auth/me");
}
