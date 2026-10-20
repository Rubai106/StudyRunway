"use client";

import { useState } from "react";
import { signIn, signOut } from "next-auth/react";
import { LogOut, ShieldCheck } from "lucide-react";

function GoogleMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48" className="h-5 w-5">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z" transform="translate(0 5)" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.73 7.18l7.66 5.94c4.47-4.13 7.11-10.21 7.11-17.59Z" />
      <path fill="#FBBC05" d="M10.53 28.59A14.4 14.4 0 0 1 9.75 24c0-1.59.27-3.13.76-4.59l-7.98-6.19A23.9 23.9 0 0 0 0 24c0 3.87.93 7.55 2.56 10.78l7.97-6.19Z" transform="translate(0 5)" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.9-5.81l-7.66-5.94c-2.13 1.43-4.85 2.28-8.24 2.28-6.26 0-11.57-4.22-13.46-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z" />
    </svg>
  );
}

export function GoogleSignIn({
  configured,
  missing = [],
}: {
  configured: boolean;
  missing?: string[];
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function continueWithGoogle() {
    setPending(true);
    setError(null);
    try {
      await signIn("google", { redirectTo: "/" });
    } catch {
      setError("Google sign-in could not start. Please try again.");
      setPending(false);
    }
  }

  return (
    <main className="sr-app-shell relative flex min-h-screen items-center justify-center bg-[var(--sr-paper)] px-5 py-12 text-[var(--sr-ink)]">
      <section className="w-full max-w-md rounded-[2rem_2rem_2rem_1.4rem] border border-[var(--sr-line)]/70 bg-[#fefefa]/90 p-8 shadow-[var(--sr-shadow-soft)] backdrop-blur-sm sm:p-10">
        <div className="mb-8 flex h-12 w-12 items-center justify-center rounded-[60%_40%_30%_70%_/_60%_30%_70%_40%] bg-[var(--sr-pine)]/10 text-[var(--sr-pine)]">
          <ShieldCheck aria-hidden="true" className="h-6 w-6" />
        </div>
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[var(--sr-pine)]">StudyRunway</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Sign in to your finance workspace</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--sr-ink)]/65">
          Use your Google account to keep your student-finance sessions private to you.
        </p>

        <button
          type="button"
          onClick={() => void continueWithGoogle()}
          disabled={!configured || pending}
          className="mt-8 flex w-full items-center justify-center gap-3 rounded-full border border-[var(--sr-line)] bg-white px-5 py-3 text-sm font-semibold text-[var(--sr-ink)] shadow-[var(--sr-shadow-soft)] transition hover:bg-[var(--sr-mist)] disabled:cursor-not-allowed disabled:opacity-55"
        >
          <GoogleMark />
          {pending ? "Connecting to Google…" : "Continue with Google"}
        </button>

        {!configured && (
          <div className="mt-5 rounded-[1.5rem] bg-[var(--sr-mist)] px-4 py-3 text-xs leading-5 text-[var(--sr-ink)]/75">
            Google sign-in needs OAuth credentials and an auth secret in the server environment. Missing settings: <span className="font-semibold">{missing.join(", ") || "server configuration"}</span>. Follow the Google OAuth steps in the project setup guide, then restart or redeploy the app.
          </div>
        )}
        {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
        <p className="mt-7 text-center text-xs leading-5 text-[var(--sr-ink)]/55">
          Your financial workspace is available only after sign-in.
        </p>
      </section>
    </main>
  );
}

export function SignOutButton() {
  return (
    <button
      type="button"
      onClick={() => void signOut({ redirectTo: "/" })}
      className="inline-flex items-center gap-2 rounded-lg border border-[#d9e0dc] px-3 py-2 text-sm font-medium text-[#355346] transition hover:bg-[#f5f8f6]"
    >
      <LogOut aria-hidden="true" className="h-4 w-4" />
      Sign out
    </button>
  );
}
