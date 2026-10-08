/**
 * app/routes/authRoutes.ts
 *
 * Identity endpoints. Mounted at /api/auth by the main router.
 *
 * Sign-in itself happens client-side against Supabase Auth — the backend never
 * sees a password. These routes only resolve who a presented token belongs to,
 * which is where the club-level `role` comes from (it lives in app_users, not in
 * the JWT).
 */

import { Router } from "express";
import type { Request, Response } from "express";
import { requireAuth } from "../middleware/requireAuth";

const router = Router();

/**
 * GET /api/auth/me
 * The signed-in member's club profile. Used by the frontend on boot to learn
 * the caller's role, which decides what the UI offers.
 */
router.get("/me", requireAuth, (req: Request, res: Response) => {
  res.json(req.user);
});

export default router;
