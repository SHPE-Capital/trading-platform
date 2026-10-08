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
  /** Emails a reset link that lands on the set-password screen. */
  sendPasswordReset: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const SET_PASSWORD_PATH = "/set-password";

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

    // Invite links land on the Supabase Site URL with the session in the URL
    // hash, and the dashboard's invite form can't choose another landing page.
    // Read the hash before the client consumes it, then send the invited or
    // recovering member to the password screen once their session is in place.
    const arrivedViaPasswordLink =
      /[#&]type=(invite|recovery)\b/.test(window.location.hash) &&
      window.location.pathname !== SET_PASSWORD_PATH;

    supabase.auth.getSession().then(({ data }) => {
      if (arrivedViaPasswordLink && data.session) {
        window.location.replace(SET_PASSWORD_PATH);
        return;
      }
      return syncProfile(data.session);
    });

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
      options: {
        emailRedirectTo: typeof window !== "undefined" ? window.location.origin : undefined,
        // Membership is provisioned by club leads. Never turn the public magic
        // link form into an account-creation endpoint if the Supabase dashboard
        // sign-up toggle is accidentally left enabled.
        shouldCreateUser: false,
      },
    });
    if (otpError) throw new Error(otpError.message);
  }, []);

  const sendPasswordReset = useCallback(async (email: string) => {
    const supabase = getSupabase();
    if (!supabase) throw new Error("Authentication is not configured");
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}${SET_PASSWORD_PATH}`,
    });
    if (resetError) throw new Error(resetError.message);
  }, []);

  /** Sets the password on the current session — the member's own, never an admin's. */
  const updatePassword = useCallback(async (password: string) => {
    const supabase = getSupabase();
    if (!supabase) throw new Error("Authentication is not configured");
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) throw new Error(updateError.message);
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
        sendPasswordReset,
        updatePassword,
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
