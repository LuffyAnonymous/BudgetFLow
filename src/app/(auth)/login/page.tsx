"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  LucideLock,
  LucideMail,
  LucideLoader2,
  LucideMessageSquareText,
  LucideCreditCard,
  LucideSparkles,
} from "lucide-react";

const loginSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

const highlights = [
  {
    icon: LucideMessageSquareText,
    text: "Reads bank & BNPL SMS the moment they land",
  },
  {
    icon: LucideCreditCard,
    text: "Keeps credit card spend separate from real cash",
  },
  {
    icon: LucideSparkles,
    text: "Smart Insights recommend what's safe to spend",
  },
];

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const onSubmit = async (data: LoginFormValues) => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await signIn("credentials", {
        email: data.email.trim().toLowerCase(),
        password: data.password,
        redirect: false,
      });

      if (result?.error) {
        setError("Invalid email or password");
      } else {
        router.push("/dashboard");
        router.refresh();
      }
    } catch (err) {
      console.error("Login submission error:", err);
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen w-full bg-neutral-950 text-slate-100">
      {/* Brand panel */}
      <div className="relative hidden w-full flex-col justify-between overflow-hidden bg-gradient-to-br from-indigo-950 via-slate-950 to-cyan-950 p-12 lg:flex lg:w-[46%] xl:w-[42%]">
        <div className="pointer-events-none absolute -top-32 -left-24 h-96 w-96 rounded-full bg-indigo-500/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -right-16 h-80 w-80 rounded-full bg-cyan-500/10 blur-3xl" />

        <div className="relative flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-indigo-500 to-cyan-500 shadow-lg shadow-indigo-500/25">
            <span className="text-lg font-bold text-white">B</span>
          </div>
          <span className="text-lg font-bold tracking-tight text-white">
            BudgetFlow
          </span>
        </div>

        <div className="relative space-y-10">
          <svg
            viewBox="0 0 320 96"
            fill="none"
            className="h-20 w-full max-w-xs"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id="flowLine" x1="0" y1="0" x2="320" y2="0" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#6366f1" />
                <stop offset="100%" stopColor="#22d3ee" />
              </linearGradient>
              <linearGradient id="flowFill" x1="0" y1="0" x2="0" y2="96" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#6366f1" stopOpacity="0.25" />
                <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path
              d="M0 72 L40 68 L72 78 L108 40 L148 52 L184 20 L224 34 L260 10 L320 22 L320 96 L0 96 Z"
              fill="url(#flowFill)"
            />
            <path
              d="M0 72 L40 68 L72 78 L108 40 L148 52 L184 20 L224 34 L260 10 L320 22"
              stroke="url(#flowLine)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="320" cy="22" r="4" fill="#22d3ee" />
          </svg>

          <div>
            <h1 className="text-4xl font-extrabold leading-tight tracking-tight text-white">
              Your bank texts you.
              <br />
              BudgetFlow reads it.
            </h1>
            <p className="mt-4 max-w-sm text-base text-slate-400">
              Every card swipe, BNPL split, and salary deposit gets logged and
              categorized on its own — no receipts to type in, no spreadsheet
              to keep up to date.
            </p>
          </div>
        </div>

        <ul className="relative space-y-4">
          {highlights.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-center gap-3 text-sm text-slate-300">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5">
                <Icon className="h-4 w-4 text-cyan-300" />
              </span>
              {text}
            </li>
          ))}
        </ul>
      </div>

      {/* Form panel */}
      <div className="flex w-full flex-1 items-center justify-center p-6 sm:p-12">
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
            Welcome back
          </h2>
          <p className="mt-2 text-sm text-slate-400">
            Sign in to see where your money&apos;s going.
          </p>

          {error && (
            <div className="mt-6 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400 text-center animate-pulse">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)} className="mt-8 space-y-6">
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
                  placeholder="admin@budgetflow.com"
                  {...register("email")}
                  className="w-full rounded-xl border border-slate-800 bg-slate-950/50 py-3 pl-11 pr-4 text-sm text-slate-100 placeholder-slate-600 outline-none transition-all focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>
              {errors.email && (
                <span className="text-xs text-red-400">{errors.email.message}</span>
              )}
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
                  placeholder="••••••••"
                  {...register("password")}
                  className="w-full rounded-xl border border-slate-800 bg-slate-950/50 py-3 pl-11 pr-4 text-sm text-slate-100 placeholder-slate-600 outline-none transition-all focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>
              {errors.password && (
                <span className="text-xs text-red-400">{errors.password.message}</span>
              )}
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="flex w-full items-center justify-center rounded-xl bg-gradient-to-r from-indigo-500 to-cyan-500 py-3 text-sm font-semibold text-white shadow-lg transition-all hover:brightness-110 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
            >
              {isLoading ? (
                <LucideLoader2 className="h-5 w-5 animate-spin" />
              ) : (
                "Sign In"
              )}
            </button>
          </form>

          <div className="mt-8 text-center text-xs text-slate-500">
            Don&apos;t have an account?{" "}
            <Link href="/signup" className="font-semibold text-indigo-400 hover:text-indigo-300">
              Sign up
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
