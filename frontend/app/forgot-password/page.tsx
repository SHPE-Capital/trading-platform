/**
 * app/forgot-password/page.tsx
 *
 * Emails a password-reset link. The link lands on /set-password, where the
 * member chooses their own password — it never passes through an admin.
 *
 * The confirmation is the same whether or not the address has an account, so
 * the form can't be used to discover who is in the club.
 */

"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuth } from "../../context/AuthContext";

export default function ForgotPasswordPage() {
  const { sendPasswordReset, isConfigured } = useAuth();

  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await sendPasswordReset(email);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the reset link");
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

  return (
    <div className="mx-auto max-w-sm px-6 py-16">
      <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        Reset your password
      </h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        We&apos;ll email you a link to choose a new one.
      </p>

      {sent ? (
        <p role="status" className="mt-8 text-sm text-green-700 dark:text-green-400">
          If {email} belongs to a club account, a reset link is on its way. It expires
          after a short time, so use it soon.
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="reset-email" className="text-xs font-medium text-zinc-500">
              Email
            </label>
            <input
              id="reset-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
          </div>

          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {isSubmitting ? "Sending…" : "Email me a reset link"}
          </button>
        </form>
      )}

      <Link
        href="/login"
        className="mt-6 inline-block text-xs text-zinc-500 underline-offset-2 hover:underline dark:text-zinc-400"
      >
        Back to sign in
      </Link>
    </div>
  );
}
