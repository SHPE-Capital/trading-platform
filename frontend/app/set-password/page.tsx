/**
 * app/set-password/page.tsx
 *
 * Where invited members choose their first password and where reset links
 * land. The emailed link signs the member in (the session arrives in the URL
 * and the Supabase client picks it up), so this page only needs the new
 * password — and only the member ever types it.
 *
 * Without a session the link was expired, already used, or never opened, so
 * the page points at the reset form instead of showing a dead form.
 */

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "../../context/AuthContext";
import { getSupabase } from "../../lib/supabaseClient";

/** Matches the shortest length we ask for; Supabase may enforce a stricter policy. */
const MIN_PASSWORD_LENGTH = 12;

type SessionState = "checking" | "ready" | "missing";

export default function SetPasswordPage() {
  const router = useRouter();
  const { updatePassword, isConfigured } = useAuth();

  const [session, setSession] = useState<SessionState>("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) return;
    let cancelled = false;

    // getSession waits for the client to finish reading the link's token.
    void supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setSession(data.session ? "ready" : "missing");
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      if (next) setSession("ready");
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }
    setIsSubmitting(true);
    try {
      await updatePassword(password);
      router.replace("/approvals");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not set the password");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isConfigured) {
    return (
      <div className="mx-auto max-w-sm px-6 py-16">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Authentication isn&apos;t configured. See the{" "}
          <Link href="/login" className="underline">sign-in page</Link> for setup steps.
        </p>
      </div>
    );
  }

  if (session === "checking") {
    return (
      <div className="mx-auto max-w-sm px-6 py-16">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Checking your link…</p>
      </div>
    );
  }

  if (session === "missing") {
    return (
      <div className="mx-auto max-w-sm px-6 py-16">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          This link has expired
        </h1>
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
          Sign-in links work once and expire quickly.{" "}
          <Link href="/forgot-password" className="font-medium text-zinc-900 underline dark:text-zinc-50">
            Request a new one
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm px-6 py-16">
      <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        Choose your password
      </h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Only you will know it. At least {MIN_PASSWORD_LENGTH} characters; a passphrase works well.
      </p>

      <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="new-password" className="text-xs font-medium text-zinc-500">
            New password
          </label>
          <input
            id="new-password"
            type="password"
            required
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="confirm-password" className="text-xs font-medium text-zinc-500">
            Confirm password
          </label>
          <input
            id="confirm-password"
            type="password"
            required
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
        </div>

        {error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {isSubmitting ? "Saving…" : "Set password"}
        </button>
      </form>
    </div>
  );
}
