"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import Link from "next/link";
import { LucideLock, LucideMail, LucideUser, LucideLoader2, LucideCheckCircle2 } from "lucide-react";
import { BrandPanel } from "@/components/auth/brand-panel";

const signupSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(50),
  lastName: z.string().trim().min(1, "Last name is required").max(50),
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

type SignupFormValues = z.infer<typeof signupSchema>;

function SignupForm() {
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SignupFormValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      email: "",
      password: "",
    },
  });

  const onSubmit = async (data: SignupFormValues) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: data.firstName,
          lastName: data.lastName,
          email: data.email.trim().toLowerCase(),
          password: data.password,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error?.message ?? "Could not create your account. Please try again.");
        return;
      }
      setSuccess(true);
    } catch (err) {
      console.error("Sign-up submission error:", err);
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  if (success) {
    return (
      <div className="relative mb-2 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/15">
          <LucideCheckCircle2 className="h-6 w-6 text-emerald-400" />
        </div>
        <h2 className="text-lg font-bold text-white">Account created</h2>
        <p className="mt-2 text-sm text-slate-400">
          Sign in with your new email and password to get started.
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
    <>
      {error && (
        <div className="mb-6 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400 text-center animate-pulse">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              First Name
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-500">
                <LucideUser className="h-5 w-5" />
              </span>
              <input
                type="text"
                placeholder="Jane"
                {...register("firstName")}
                className="w-full rounded-xl border border-slate-800 bg-slate-950/50 py-3 pl-11 pr-4 text-sm text-slate-100 placeholder-slate-600 outline-none transition-all focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>
            {errors.firstName && <span className="text-xs text-red-400">{errors.firstName.message}</span>}
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Last Name
            </label>
            <input
              type="text"
              placeholder="Doe"
              {...register("lastName")}
              className="w-full rounded-xl border border-slate-800 bg-slate-950/50 py-3 px-4 text-sm text-slate-100 placeholder-slate-600 outline-none transition-all focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
            />
            {errors.lastName && <span className="text-xs text-red-400">{errors.lastName.message}</span>}
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Email Address
          </label>
          <div className="relative">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-500">
              <LucideMail className="h-5 w-5" />
            </span>
            <input
              type="email"
              placeholder="you@example.com"
              {...register("email")}
              className="w-full rounded-xl border border-slate-800 bg-slate-950/50 py-3 pl-11 pr-4 text-sm text-slate-100 placeholder-slate-600 outline-none transition-all focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>
          {errors.email && <span className="text-xs text-red-400">{errors.email.message}</span>}
        </div>

        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Password
          </label>
          <div className="relative">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-500">
              <LucideLock className="h-5 w-5" />
            </span>
            <input
              type="password"
              placeholder="At least 8 characters"
              {...register("password")}
              className="w-full rounded-xl border border-slate-800 bg-slate-950/50 py-3 pl-11 pr-4 text-sm text-slate-100 placeholder-slate-600 outline-none transition-all focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>
          {errors.password && <span className="text-xs text-red-400">{errors.password.message}</span>}
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="flex w-full items-center justify-center rounded-xl bg-gradient-to-r from-indigo-500 to-cyan-500 py-3 text-sm font-semibold text-white shadow-lg transition-all hover:brightness-110 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
        >
          {isLoading ? <LucideLoader2 className="h-5 w-5 animate-spin" /> : "Create Account"}
        </button>
      </form>

      <div className="mt-8 text-center text-xs text-slate-500">
        Already have an account?{" "}
        <Link href="/login" className="font-semibold text-indigo-400 hover:text-indigo-300">
          Sign in
        </Link>
      </div>

      <div className="mt-4 flex items-center justify-center gap-3 text-[11px] text-slate-600">
        <Link href="/terms" className="hover:text-slate-400">
          Terms & Conditions
        </Link>
        <span aria-hidden="true">·</span>
        <Link href="/privacy" className="hover:text-slate-400">
          Privacy Policy
        </Link>
      </div>
    </>
  );
}

export default function SignupPage() {
  return (
    <div className="flex min-h-screen w-full bg-neutral-950 text-slate-100">
      <BrandPanel />

      {/* Form panel */}
      <div className="flex w-full flex-1 items-center justify-center p-6 sm:p-10 lg:px-6 xl:px-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-tr from-indigo-500 to-cyan-500 shadow-md shadow-indigo-500/20">
              <span className="text-base font-bold text-white">B</span>
            </div>
            <span className="text-base font-bold tracking-tight text-white">
              BudgetFlow
            </span>
          </div>

          <h2 className="text-2xl font-bold tracking-tight text-white">
            Create your account
          </h2>
          <p className="mt-2 text-sm text-slate-400">
            Start tracking your cash flow automatically.
          </p>

          <div className="mt-8">
            <SignupForm />
          </div>
        </div>
      </div>
    </div>
  );
}
