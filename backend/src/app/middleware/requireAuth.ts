/**
 * app/middleware/requireAuth.ts
 *
 * Authentication and role gating for the REST API.
 *
 * The frontend signs in through Supabase Auth and sends the resulting JWT as a
 * bearer token. This middleware verifies it, loads the caller's club profile,
 * and attaches both to the request as `req.user`.
 *
 * Note on enforcement: the backend talks to Postgres with the service-role key,
 * which bypasses RLS by design (the live runner and backtest workers act for the
 * whole club, not one member). So the RLS policies in 0003/0006/0007 are a
 * second net for anything that ever queries with a user JWT directly — the
 * primary ownership checks are the explicit ones in the controllers.
 *
 * Inputs:  Authorization: Bearer <supabase jwt>
 * Outputs: req.user populated, or 401/403.
 */

import type { Request, Response, NextFunction } from "express";
import { getSupabaseClient } from "../../adapters/supabase/client";
import { getAppUserById } from "../../adapters/supabase/reviewRepositories";
import { logger } from "../../utils/logger";
import type { AuthenticatedUser, UserRole } from "../../types/review";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Populated by requireAuth. Absent on unauthenticated routes. */
      user?: AuthenticatedUser;
    }
  }
}

/** Pulls the bearer token off the Authorization header, if present. */
function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

/**
 * Verifies the caller's JWT and loads their profile.
 * Responds 401 and stops the chain when the token is missing or invalid.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = bearerToken(req);
  if (!token) {
    res.status(401).json({ error: "Not signed in" });
    return;
  }

  try {
    const { data, error } = await getSupabaseClient().auth.getUser(token);
    if (error || !data?.user) {
      res.status(401).json({ error: "Session expired or invalid — sign in again" });
      return;
    }

    // The on_auth_user_created trigger (0008) guarantees a row exists; a miss
    // means the trigger has not been applied to this database yet.
    const profile = await getAppUserById(data.user.id);
    if (!profile) {
      logger.error("requireAuth: no app_users row for authenticated user", { userId: data.user.id });
      res.status(403).json({
        error: "No club profile for this account",
        detail: "Ask a lead to provision your account — migration 0008 creates these automatically.",
      });
      return;
    }
    if (profile.membershipStatus !== "active") {
      res.status(403).json({
        error: profile.membershipStatus === "suspended" ? "Membership suspended" : "Membership pending",
        detail: "A club lead must activate this account before it can access the trading platform.",
      });
      return;
    }

    req.user = {
      id: profile.id,
      email: profile.email,
      role: profile.role,
      displayName: profile.displayName,
      membershipStatus: profile.membershipStatus,
    };
    next();
  } catch (err) {
    logger.error("requireAuth: verification threw", { err: String(err) });
    res.status(401).json({ error: "Could not verify session" });
  }
}

/**
 * Restricts a route to one or more roles. Must run after requireAuth.
 *
 * @param roles - Roles permitted to proceed
 */
export function requireRole(...roles: UserRole[]) {
  return function roleGate(req: Request, res: Response, next: NextFunction): void {
    if (!req.user) {
      res.status(401).json({ error: "Not signed in" });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({
        error: `This action requires the ${roles.join(" or ")} role`,
        detail: `You are signed in as ${req.user.role}.`,
      });
      return;
    }
    next();
  };
}

/**
 * Attaches req.user when a valid token is present but never rejects.
 *
 * Used for read routes that stay open to the whole club (the book is shared, so
 * results are shared) while still letting a handler tailor the response — for
 * example flagging which proposals the caller may act on.
 */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = bearerToken(req);
  if (!token) return next();
  try {
    const { data } = await getSupabaseClient().auth.getUser(token);
    if (data?.user) {
      const profile = await getAppUserById(data.user.id);
      if (profile) {
        req.user = {
          id: profile.id,
          email: profile.email,
          role: profile.role,
          displayName: profile.displayName,
          membershipStatus: profile.membershipStatus,
        };
      }
    }
  } catch {
    // A bad token on an optional route is simply an anonymous caller.
  }
  next();
}
