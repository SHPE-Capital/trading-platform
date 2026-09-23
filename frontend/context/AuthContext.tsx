/**
 * context/AuthContext.tsx
 *
 * Session state for the whole app: who is signed in, what role they hold, and
 * the sign-in / sign-out actions.
 *
 * Role comes from the backend rather than the JWT, because `role` lives in
 * app_users (a club-level concept) and not in Supabase's auth metadata. The
 * profile is fetched once per session and refreshed on auth state changes.
 *
 * Inputs:  Supabase auth session.
 * Outputs: { user, role, isLoading, signIn, signOut } via useAuth().
 */

"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabase, isAuthConfigured } from "../lib/supabaseClient";
import { fetchMe } from "../services/authService";
import type { AuthUser } from "../types/review";

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  /** True when NEXT_PUBLIC_SUPABASE_* are set; false puts the app in setup mode. */
  isConfigured: boolean;
  error: string | null;
  signInWithPassword: (email: string, password: string) => Promise<void>;
  signInWithMagicLink: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(isAuthConfigured);
  const [error, setError] = useState<string | null>(null);

  /** Loads the club profile for a signed-in session, or clears it. */
  const syncProfile = useCallback(async (session: Session | null) => {
    if (!session) {
      setUser(null);
      setIsLoading(false);
      return;
    }
    try {
      setUser(await fetchMe());
    } catch (err) {
      // A valid Supabase session with no app_users row means migration 0008
      // hasn't been applied — surface that rather than a blank screen.
      setError(err instanceof Error ? err.message : "Could not load your profile");
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) {
      setIsLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data }) => syncProfile(data.session));

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      void syncProfile(session);
    });
    return () => sub.subscription.unsubscribe();
  }, [syncProfile]);

  const signInWithPassword = useCallback(async (email: string, password: string) => {
    const supabase = getSupabase();
    if (!supabase) throw new Error("Authentication is not configured");
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) throw new Error(signInError.message);
  }, []);

  const signInWithMagicLink = useCallback(async (email: string) => {
    const supabase = getSupabase();
    if (!supabase) throw new Error("Authentication is not configured");
    setError(null);
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: typeof window !== "undefined" ? window.location.origin : undefined },
    });
    if (otpError) throw new Error(otpError.message);
  }, []);

  const signOut = useCallback(async () => {
    const supabase = getSupabase();
    if (supabase) await supabase.auth.signOut();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isConfigured: isAuthConfigured,
        error,
        signInWithPassword,
        signInWithMagicLink,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

/** Session, role, and auth actions. Throws if used outside AuthProvider. */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

/** Convenience: true when the signed-in member may approve proposals. */
export function useIsLead(): boolean {
  return useAuth().user?.role === "lead";
}
