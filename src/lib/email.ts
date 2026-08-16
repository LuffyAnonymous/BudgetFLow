/**
 * src/lib/email.ts
 *
 * Thin wrapper around Resend for transactional email. Requires
 * RESEND_API_KEY to be set — throws a clear error otherwise rather than
 * silently dropping mail, since a "sent" email that never arrived is a
 * much worse debugging experience than a loud startup-time failure.
 *
 * EMAIL_FROM defaults to Resend's shared test sender (onboarding@resend.dev),
 * which works immediately with no domain setup — fine for getting started,
 * but swap it for a verified sending address on your own domain before
 * relying on this for real users' inboxes (better deliverability, and
 * "onboarding@resend.dev" looks like a stranger's email to recipients).
 */

import "server-only";

import { Resend } from "resend";

let client: Resend | null = null;

function getClient(): Resend {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not configured — cannot send email.");
  }
  if (!client) {
    client = new Resend(apiKey);
  }
  return client;
}

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export async function sendEmail(input: SendEmailInput): Promise<void> {
  const from = process.env.EMAIL_FROM || "BudgetFlow <onboarding@resend.dev>";
  const resend = getClient();

  const { error } = await resend.emails.send({
    from,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
  });

  if (error) {
    throw new Error(`Failed to send email: ${error.message}`);
  }
}
