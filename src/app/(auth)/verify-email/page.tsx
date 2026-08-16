"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { LucideCheckCircle2, LucideXCircle, LucideLoader2 } from "lucide-react";

type Status = "checking" | "verified" | "already_verified" | "error";

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [status, setStatus] = useState<Status>(token ? "checking" : "error");
  const [errorMessage, setErrorMessage] = useState(token ? "" : "No verification token was provided.");

  useEffect(() => {
    if (!token) return;

    fetch("/api/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) {
          setStatus("error");
          setErrorMessage(json.error?.message ?? "Could not verify this email.");
          return;
        }
        setStatus(json.data.outcome === "already_verified" ? "already_verified" : "verified");
      })
      .catch(() => {
        setStatus("error");
        setErrorMessage("An unexpected error occurred. Please try again.");
      });
  }, [token]);

  if (status === "checking") {
    return (
      <div className="relative mb-2 text-center">
        <LucideLoader2 className="mx-auto h-8 w-8 animate-spin text-slate-500" />
        <p className="mt-4 text-sm text-slate-400">Verifying your email&hellip;</p>
      </div>
    );
  }

  if (status === "verified" || status === "already_verified") {
    return (
      <div className="relative mb-2 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/15">
          <LucideCheckCircle2 className="h-6 w-6 text-emerald-400" />
        </div>
        <h2 className="text-lg font-bold text-white">
          {status === "already_verified" ? "Already verified" : "Email verified"}
        </h2>
        <p className="mt-2 text-sm text-slate-400">
          Your email is confirmed. Sign in to get started.
        </p>
        <Link
          href="/login"
          className="mt-6 inline-flex w-full items-center justify-center rounded-xl bg-gradient-to-r from-indigo-500 to-cyan-500 py-3 text-sm font-semibold text-white shadow-lg transition-all hover:brightness-110 active:scale-[0.98]"
        >
          Go to Sign In
        </Link>
      </div>
    );
  }

  return (
    <div className="relative mb-2 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-red-500/15">
        <LucideXCircle className="h-6 w-6 text-red-400" />
      </div>
      <h2 className="text-lg font-bold text-white">Verification failed</h2>
      <p className="mt-2 text-sm text-slate-400">{errorMessage}</p>
      <Link
        href="/login"
        className="mt-6 inline-flex w-full items-center justify-center rounded-xl border border-slate-800 bg-slate-900/50 py-3 text-sm font-semibold text-slate-200 transition-all hover:bg-slate-800"
      >
        Back to Sign In
      </Link>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-radial from-slate-900 via-slate-950 to-black p-4 text-slate-100">
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur-xl p-8 shadow-2xl">
        <div className="absolute -top-40 -left-40 h-80 w-80 rounded-full bg-indigo-500/10 blur-3xl" />
        <div className="absolute -bottom-40 -right-40 h-80 w-80 rounded-full bg-cyan-500/10 blur-3xl" />

        <div className="relative mb-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-tr from-indigo-500 to-cyan-500 shadow-lg shadow-indigo-500/25">
            <span className="font-bold text-xl text-white">B</span>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
            BudgetFlow
          </h1>
        </div>

        <Suspense fallback={<div className="py-8 text-center text-sm text-slate-500">Loading&hellip;</div>}>
          <VerifyEmailContent />
        </Suspense>
      </div>
    </div>
  );
}
