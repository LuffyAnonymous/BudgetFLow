# Gmail Bank-Email Import — Setup Guide

BudgetFlow can automatically import bank transaction emails from a connected Gmail account —
the same auto-post/flag-for-a-second-look/fail model as SMS import, applied to email instead.
Import runs on **Gmail push notifications** (real-time, as emails arrive), not on a polling
schedule — no n8n, no third-party automation platform.

Six email formats are fully supported today. From Emirates NBD (`OnlineBanking@emiratesnbd.com`
or similar): **"Local Bank Transfer"** confirmations, **ATM withdrawal** confirmations,
**salary-credit** alerts (the first supported inflow format — everything else is an outflow),
and generic **account-deduction** alerts ("AED X has been deducted from your account...for
[reason]" — covers fees/charges/transfer costs, whatever reason text the bank fills in, since
that reason is a captured variable within the verified template, not a separate guessed
format). From Mashreq (`MashreqAlerts@mashreq.com`): the **"Transaction Notification"
bank-transfer debit alert** ("...is debited with AED...for Aani Instant Payments...") and the
**Mashreq Card purchase alert** ("...Card ending with...was used for a purchase of AED...").
Mashreq's other, richer "Local AED Transfer request via Mobile Banking" confirmation from
`MashreqDigital@mashreq.com` is not yet supported. Any other bank, and any other email format
from either of these two banks, is recognized as "not supported yet" rather than guessed at —
see "How This Differs From SMS" below.

---

## 1. Create a Google Cloud OAuth Client

BudgetFlow needs its own Google OAuth client to request read-only Gmail access on your behalf.

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and create a new projectMy Project 20787
   (or reuse an existing one you control).
2. **APIs & Services → Library** — enable the **Gmail API** and the **Cloud Pub/Sub API**.
3. **APIs & Services → OAuth consent screen**:
   - User type: **External** (Internal requires a Google Workspace org).
   - Publishing status: leave as **Testing** — see "The 7-Day Reconnect Trade-off" below for why.
   - Under **Test users**, add your own Google account's email address. Only test users can
     complete the consent flow while the app is in Testing status.
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Web application**.
   - Authorized redirect URIs — add both:
     - `https://your-budgetflow-domain.com/api/integrations/gmail/callback`
     - `http://localhost:3000/api/integrations/gmail/callback` (for local dev)
5. Copy the generated **Client ID** and **Client Secret**.

## 2. Create a Pub/Sub Topic and Push Subscription

Gmail delivers push notifications through Google Cloud Pub/Sub — this is the actual real-time
trigger, so it's not optional.

1. **Pub/Sub → Topics → Create Topic**. Name it something like `gmail-push`. Copy its full
   resource name (`projects/<your-project-id>/topics/gmail-push`).
2. Grant Gmail's own service account permission to publish to it: on the topic, **Permissions →
   Add Principal** → principal `gmail-api-push@system.gserviceaccount.com` → role
   **Pub/Sub Publisher**.
3. On the same topic, **Create Subscription**:
   - Delivery type: **Push**.
   - Endpoint URL: `https://your-budgetflow-domain.com/api/webhooks/gmail-push?secret=<your GMAIL_PUSH_WEBHOOK_SECRET>`
     (generate that secret now if you haven't — see step 3 below — it has to match exactly).
   - Leave the rest at defaults.

## 3. Configure Environment Variables

Add to your `.env` (or Vercel project environment variables):

```bash
GOOGLE_CLIENT_ID="your-client-id-here"
GOOGLE_CLIENT_SECRET="your-client-secret-here"
GMAIL_TOKEN_ENCRYPTION_KEY="<openssl rand -hex 32>"
GOOGLE_PUBSUB_TOPIC="projects/your-gcp-project/topics/gmail-push"
GMAIL_PUSH_WEBHOOK_SECRET="<openssl rand -hex 32>"
```

`GMAIL_TOKEN_ENCRYPTION_KEY` and `GMAIL_PUSH_WEBHOOK_SECRET` should each be freshly generated —
don't reuse another secret for either.

## 4. Set Up Weekly Watch Renewal (GitHub Actions)

A Gmail push subscription (a "watch") expires after 7 days no matter what — Google's own hard
limit, unrelated to OAuth token status. `.github/workflows/gmail-watch-renew.yml` (already in
this repo) renews it weekly with a safety margin. It needs two repository secrets:

1. In your GitHub repo: **Settings → Secrets and variables → Actions → New repository secret**.
2. Add `BUDGETFLOW_BASE_URL` (e.g. `https://your-budgetflow-domain.com`, no trailing slash).
3. Add `CRON_SECRET` — the same value already configured on your deployment (`.env.example`).

The workflow also has a manual `workflow_dispatch` trigger if you want to run it once
immediately rather than waiting for the weekly schedule.

## 5. Connect Your Gmail Account

1. Go to **Settings → Gmail**.
2. Click **Connect Gmail**.
3. Sign in and approve the read-only Gmail permission on Google's consent screen.
4. You're redirected back to Settings, now showing **Connected as `you@gmail.com`**. The push
   subscription starts immediately (not on the next weekly renewal), and BudgetFlow also does
   one sync right away so recent emails show up without waiting for a new one to arrive.

## 6. The 7-Day Reconnect Trade-off

Gmail read access is a Google-classified *sensitive* scope. An app that hasn't been through
Google's formal verification process (a real undertaking — potentially a paid third-party
security assessment — disproportionate for a personal single-user app) only gets a refresh
token valid for **7 days** while in Testing status. After that, the connection stops working
silently on Google's end until you reconnect.

This is separate from the weekly watch renewal above (that's Google's push-subscription limit;
this is the OAuth refresh-token limit) — either one lapsing has the same visible effect.
BudgetFlow surfaces it as an in-app notification and an amber "needs attention" state on the
Settings Gmail card as soon as a sync or renewal fails due to an expired/revoked token —
reconnecting is a single click on **Reconnect Gmail**, not a re-do of the setup steps above.

## 7. How Auto-Import Works (and How It Differs From SMS)

Each push notification (or the one-time sync right after connecting) checks for new emails and
imports anything it can parse, same two-outcome model as SMS — **auto-post or fail, no review
queue**:

- A recognized email in a supported format posts immediately. If confidence is anything less
  than a clean HIGH read, it's tagged **"needs a second look"** on the Imports page.
- An email from a bank domain BudgetFlow doesn't recognize at all, or a recognized bank in a
  format not yet supported, never becomes a transaction — it's recorded as **Failed** with a
  specific reason (`UNRECOGNIZED_SENDER_DOMAIN` vs. `RECOGNIZED_SENDER_NO_PARSER`), same
  never-silently-drop guarantee SMS import has.

Two differences from SMS worth knowing:

- **No AI fallback.** SMS falls back to an AI extractor when no regex parser matches; email
  import doesn't (yet) — only the registered structured parsers apply. An unsupported email
  format fails cleanly rather than being guessed at.
- **Direction is read from labeled fields, not inferred from wording.** SMS has to guess a
  message's debit/credit direction from keywords in free text (and flags itself when that
  guess is ambiguous). Email confirmations label this explicitly (e.g. "Debit Amount:"), so
  there's no equivalent ambiguity signal for email — the parser reads it directly.

Adding support for another bank or another Emirates NBD email format requires a real (redacted)
sample email — BudgetFlow's import parsers are never built from a guessed format.

### Catching up a transaction that failed before its format was supported

A push notification only fires once, the moment an email arrives. If that email failed because
its format wasn't supported yet, and support gets added *afterward*, that message doesn't
automatically get a second try — its original push notification already fired and won't fire
again. **Settings → Gmail → Resync Last 7 Days** re-scans the last 7 days of email from ENBD and
Mashreq (filtered server-side by Gmail's own search — by both sender and date — so nothing else
in the inbox is ever touched) through the same pipeline, so a newly supported format picks up
any recent transaction that failed on it. Already-imported transactions are skipped (same
message-ID dedup as normal sync), so it's safe to run repeatedly. A transaction older than 7
days that failed before its format was supported won't be picked up by this — clear it from the
Failed tab and re-enter it manually, or ask for the resync window to be widened if this becomes
a recurring need.

## 8. Disconnecting

**Settings → Gmail → Disconnect** immediately tells Google to stop sending push notifications
for your account and revokes the integration on BudgetFlow's side. Already-imported transactions
are untouched.

## 9. Security Notes

- Gmail access is **read-only** (`gmail.readonly`) — BudgetFlow can never send, delete, or
  modify anything in your inbox.
- **Only registered UAE bank domains are ever touched.** Every new inbox message is checked
  by sender domain first (a cheap header-only fetch, no body) — anything that isn't from a
  recognized bank domain (currently `emiratesnbd.com` and `mashreq.com`/`mashreqbank.com`) is
  skipped immediately: its body is never fetched, never parsed, and never written to the
  database, not even as a failed/unrecognized record. Personal mail, newsletters, work email,
  and anything else in your inbox is never touched beyond that one header check.
- The refresh token is encrypted at rest (AES-256-GCM) — a database compromise alone doesn't
  expose it without `GMAIL_TOKEN_ENCRYPTION_KEY`.
- The push webhook (`/api/webhooks/gmail-push`) only accepts requests carrying the correct
  `GMAIL_PUSH_WEBHOOK_SECRET`, and Pub/Sub notifications never contain the email body itself —
  only a sender address and a history cursor, which BudgetFlow uses to fetch the actual message
  directly from Gmail's API using your own connection.
- BudgetFlow stores only a **redacted version** of each imported email (account/IBAN numbers
  masked). The raw email body is not stored beyond your configured retention window.
- Audit logs record connect/disconnect events and every import outcome without storing the
  email body.
