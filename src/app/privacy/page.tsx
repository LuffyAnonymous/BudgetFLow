import Link from "next/link";
import { LucideArrowLeft } from "lucide-react";

export const metadata = {
  title: "Privacy Policy — BudgetFlow",
};

const sections = [
  {
    heading: "1. Who this covers",
    body: [
      "This policy explains what BudgetFlow collects and does with your data. BudgetFlow is a personal project maintained by Arvin, not a company — there's no data broker relationship, no ad network, and nothing here is sold to anyone.",
    ],
  },
  {
    heading: "2. What's collected",
    body: [
      "Account info: your name, email address, and a bcrypt-hashed password. The plain password itself is never stored.",
      "Transaction data: bank and BNPL SMS text (sender, message body, timestamp) that you or your linked relay or Telegram bot submits, receipt images you upload, and the transactions, categories, accounts, and balances derived from them.",
      "Usage records: an audit log of account actions — logins, imports, edits — kept for debugging and security review.",
    ],
  },
  {
    heading: "3. How SMS and receipts get processed",
    body: [
      "Most bank and BNPL SMS is parsed locally with rule-based matching — nothing leaves the server for that.",
      "When local rules can't confidently extract a merchant, amount, or category, or for photographed receipts, the raw text or image is sent to Anthropic's Claude API to extract the same details. Under Anthropic's standard commercial API terms, that data isn't used to train their models — it's used only to return the extracted transaction fields back to BudgetFlow.",
    ],
  },
  {
    heading: "4. Where things are stored",
    body: [
      "Transaction and account data lives in a PostgreSQL database. Receipt images and attachments are kept in S3-compatible object storage. Rate-limiting counters run through Redis and hold no personal data, just request counts. Sessions are managed by Auth.js (NextAuth), tied to your hashed credentials.",
    ],
  },
  {
    heading: "5. Other integrations you opt into",
    body: [
      "Telegram: if you link a Telegram account to import messages, BudgetFlow only accepts messages from chat IDs you've explicitly allow-listed.",
      "SMS relay: bank and BNPL SMS can be forwarded through a self-hosted automation relay (n8n) running on infrastructure the maintainer controls, before landing in BudgetFlow.",
      "iOS Shortcuts: an import token lets a Shortcuts automation on your own phone submit data directly to your account.",
    ],
  },
  {
    heading: "6. Retention",
    body: [
      "Your data is kept for as long as your account exists. If you want it deleted, email the address below and it will be removed along with your account.",
    ],
  },
  {
    heading: "7. Your rights",
    body: [
      "You can ask for a copy of your data, or ask for it to be deleted, at any time — just email arvinphilippoliga@gmail.com.",
    ],
  },
  {
    heading: "8. Children",
    body: ["BudgetFlow isn't intended for use by children."],
  },
  {
    heading: "9. Changes",
    body: [
      "This policy may be updated as the app changes. Meaningful changes will be reflected here with a new effective date.",
    ],
  },
];

export default function PrivacyPage() {
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
          Privacy Policy
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
              10. Contact
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-400">
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
          <Link href="/terms" className="text-indigo-400 hover:text-indigo-300">
            Terms & Conditions
          </Link>
          .
        </div>
      </div>
    </div>
  );
}
