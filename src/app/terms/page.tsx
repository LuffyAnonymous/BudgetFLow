import Link from "next/link";
import { LucideArrowLeft } from "lucide-react";

export const metadata = {
  title: "Terms & Conditions — BudgetFlow",
};

const sections = [
  {
    heading: "1. About BudgetFlow",
    body: [
      "BudgetFlow is a personal finance tool built and maintained by Arvin. It's a personal project, not a company or a registered financial service — there's no support team, no service-level agreement, and no guarantee it stays running.",
      "It exists to track spending automatically by reading bank and buy-now-pay-later SMS notifications and receipts and turning them into categorized transactions.",
    ],
  },
  {
    heading: "2. Who can use it",
    body: [
      "Access to BudgetFlow is invite-only. If you've been given login credentials, you're allowed to use the app for your own personal budgeting — not to resell it, redistribute it, or expose it to anyone else.",
      "You're responsible for keeping your password, and any Telegram- or SMS-relay linking credentials, confidential.",
    ],
  },
  {
    heading: "3. What the app does with your data",
    body: [
      "When you connect a bank SMS relay, link a Telegram account, or upload a receipt, BudgetFlow tries to extract the transaction details — merchant, amount, date, category — automatically.",
      "Most of that happens with pattern-matching rules built for UAE banks and BNPL providers (Emirates NBD, Mashreq, ADCB, FAB, RAKBANK, DIB, CBD, ADIB, HSBC UAE, SIB, WIO, LIV, Tabby, and similar). When the rules can't confidently parse a message or receipt, it's sent to Anthropic's Claude API as a fallback to extract the same details. See the Privacy Policy for exactly what that involves.",
    ],
  },
  {
    heading: "4. Not financial advice",
    body: [
      "The Smart Insights feature — salary detection, recommended spend/save split, debt tracking — is a set of automated estimates based on the transactions you've imported. It is not financial, tax, or investment advice, and it can be wrong, especially if a transaction was parsed incorrectly.",
      "Always check your actual bank statements before making financial decisions.",
    ],
  },
  {
    heading: "5. No warranty",
    body: [
      "BudgetFlow is provided as-is, with no uptime guarantee, no warranty, and no promise that parsing will always be accurate or that data won't ever be lost. It runs on infrastructure maintained in spare time, not a hosted production service.",
    ],
  },
  {
    heading: "6. Limitation of liability",
    body: [
      "The maintainer is not liable for financial losses, missed payments, or decisions made based on BudgetFlow's output. You're responsible for verifying your own financial data against your bank's records.",
    ],
  },
  {
    heading: "7. Changes",
    body: [
      "These terms, or the app itself, may change at any time without advance notice. Continuing to use BudgetFlow after a change means you accept the update.",
    ],
  },
];

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-neutral-950 text-slate-100">
      <div className="mx-auto max-w-3xl px-6 py-16 sm:px-8">
        <Link
          href="/login"
          className="inline-flex items-center gap-2 text-sm font-medium text-slate-400 transition-colors hover:text-slate-200"
        >
          <LucideArrowLeft className="h-4 w-4" />
          Back to sign in
        </Link>

        <div className="mt-8 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-tr from-indigo-500 to-cyan-500 shadow-md shadow-indigo-500/20">
            <span className="text-base font-bold text-white">B</span>
          </div>
          <span className="text-base font-bold tracking-tight text-white">
            BudgetFlow
          </span>
        </div>

        <h1 className="mt-8 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
          Terms & Conditions
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          Effective August 20, 2026
        </p>

        <div className="mt-12 space-y-10">
          {sections.map((section) => (
            <section key={section.heading}>
              <h2 className="text-lg font-semibold tracking-tight text-white">
                {section.heading}
              </h2>
              <div className="mt-3 space-y-3">
                {section.body.map((paragraph) => (
                  <p key={paragraph} className="text-sm leading-relaxed text-slate-400">
                    {paragraph}
                  </p>
                ))}
              </div>
            </section>
          ))}

          <section>
            <h2 className="text-lg font-semibold tracking-tight text-white">
              8. Contact
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-400">
              Questions or concerns:{" "}
              <a
                href="mailto:arvinphilippoliga@gmail.com"
                className="font-medium text-indigo-400 hover:text-indigo-300"
              >
                arvinphilippoliga@gmail.com
              </a>
            </p>
          </section>
        </div>

        <div className="mt-16 border-t border-slate-800 pt-6 text-xs text-slate-500">
          See also the{" "}
          <Link href="/privacy" className="text-indigo-400 hover:text-indigo-300">
            Privacy Policy
          </Link>
          .
        </div>
      </div>
    </div>
  );
}
