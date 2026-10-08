/**
 * app/login/page.tsx
 *
 * Sign-in screen. Supports password and magic-link, since a student club is
 * likely to onboard members by emailed link rather than issuing passwords.
 *
 * When Supabase env vars are missing the page explains what to set instead of
 * failing with an opaque network error — the most likely first-run state.
 */

"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "../../context/AuthContext";

export default function LoginPage() {
  const router = useRouter();
  const { signInWithPassword, signInWithMagicLink, isConfigured, user } = useAuth();

  const [mode, setMode] = useState<"password" | "magic">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (user) {
    // Already signed in — nothing to do here.
    router.replace("/approvals");
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setStatus(null);
    setIsSubmitting(true);
    try {
      if (mode === "password") {
        await signInWithPassword(email, password);
        router.replace("/approvals");
      } else {
        await signInWithMagicLink(email);
        setStatus(`Check ${email} for a sign-in link.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isConfigured) {
    return (
      <div className="mx-auto max-w-lg px-6 py-16">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          Authentication isn&apos;t configured
        </h1>
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
          Set these in <code className="rounded bg-zinc-100 px-1 py-0.5 text-xs dark:bg-zinc-800">frontend/.env.local</code>{" "}
          and restart the dev server:
        </p>
        <pre className="mt-4 overflow-x-auto rounded-md border border-zinc-200 bg-white p-4 text-xs text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
{`NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>`}
        </pre>
        <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
          Authentication creates a pending profile through the
          <code className="mx-1 rounded bg-zinc-100 px-1 py-0.5 text-xs dark:bg-zinc-800">on_auth_user_created</code>
          trigger. Activate a verified club member with{" "}
          <code className="rounded bg-zinc-100 px-1 py-0.5 text-xs dark:bg-zinc-800">
            update app_users set membership_status = &apos;active&apos; where email = &apos;…&apos;
          </code>. Promote an active member to approver with{" "}
          <code className="rounded bg-zinc-100 px-1 py-0.5 text-xs dark:bg-zinc-800">
            update app_users set role = &apos;lead&apos; where email = &apos;…&apos;
          </code>.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm px-6 py-16">
      <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        Sign in
      </h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        SHPE Capital trading platform
      </p>

      <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="login-email" className="text-xs font-medium text-zinc-500">
            Email
          </label>
          <input
            id="login-email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
        </div>

        {mode === "password" && (
          <div className="flex flex-col gap-1">
            <label htmlFor="login-password" className="text-xs font-medium text-zinc-500">
              Password
            </label>
            <input
              id="login-password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
          </div>
        )}

        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
        {status && <p className="text-xs text-green-700 dark:text-green-400">{status}</p>}

        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {isSubmitting
            ? "Working…"
            : mode === "password"
              ? "Sign in"
              : "Email me a link"}
        </button>

        {mode === "password" && (
          <Link
            href="/forgot-password"
            className="text-xs text-zinc-500 underline-offset-2 hover:underline dark:text-zinc-400"
          >
            Forgot your password?
          </Link>
        )}

        <button
          type="button"
          onClick={() => { setMode(mode === "password" ? "magic" : "password"); setError(null); setStatus(null); }}
          className="text-xs text-zinc-500 underline-offset-2 hover:underline dark:text-zinc-400"
        >
          {mode === "password" ? "Use a magic link instead" : "Use a password instead"}
        </button>
      </form>
    </div>
  );
}
