# BudgetFlow n8n Automation Architecture

This folder contains importable n8n workflow JSON files implementing BudgetFlow's
full automation layer: multi-channel intake, parsing, validation, deduplication,
categorization, API orchestration, notifications, scheduling, and shared
utilities.

## A known trade-off, by design

BudgetFlow already has a complete, tested import pipeline for SMS and Telegram
(`importService.processSms()` in `src/imports/engine/import.service.ts`), and
the app's own `/api/integrations/telegram/webhook` and
`/api/integrations/sms/shortcut` already call straight into it. The
`01-intake` → `02-processing` pipeline below is a **second, parallel
implementation** of parsing/validation/dedup/categorization, built inside n8n
at explicit request even though it duplicates that logic. The two pipelines
will not stay in sync automatically — if you improve bank-format parsing in
the app, you'd need to mirror it in `02-processing/parse-transaction.json`
separately. This was a deliberate choice (see project discussion), not an
oversight.

## Folder structure

```
n8n/workflows/
├── 01-intake/
│   ├── sms-import.json                    # generic SMS webhook (any forwarding app) — per-user relay, see below
│   ├── manual-import.json                 # single quick-add entry, raw text or structured fields
│   ├── manual-csv-bulk-import.json        # batch backfill via CSV upload (pre-existing)
│   └── email-import-gmail.json            # scaffold, inactive (pre-existing)
│
├── 02-processing/
│   ├── parse-transaction.json             # heuristic text → draft transaction fields
│   ├── validate-transaction.json          # required-field/shape checks
│   ├── duplicate-check.json               # amount + same-day match against existing transactions
│   └── categorize-transaction.json        # keyword → categoryId resolution
│
├── 03-budgetflow-api-client/              # thin, reusable HTTP wrappers
│   ├── create-transaction.json
│   ├── update-account-balance.json        # confirmation/logging only, not a second write
│   ├── record-debt-payment.json
│   ├── record-savings-transaction.json
│   └── create-remittance.json
│
├── 04-notifications/                      # delivery/fan-out only, no business logic
│   ├── import-failed.json
│   ├── low-confidence-import.json
│   ├── system-error.json
│   └── error-trigger.json                 # instance-wide catch-all, see "Error handling & retries"
│
├── 05-utilities/
│   ├── logger.json
│   ├── retry-handler.json
│   ├── date-time-helpers.json
│   └── api-authentication.json
│
└── 06-scheduling-orchestration/           # cron + retry + alerting (pre-existing, renumbered from 02)
    ├── daily-recurring-transactions-trigger.json
    ├── monthly-rollover-trigger.json
    ├── notification-evaluation-trigger.json
    ├── system-health-check.json
    └── import-retention-cleanup.json
```

Naming follows the pattern `"01 - Intake / SMS Import"` (not n8n's native
Folders feature, which needs Enterprise/Cloud) so workflows sort and group
correctly in the UI regardless of your n8n edition.

## Pipeline

```
01-intake (SMS / Telegram / Manual)
  → 02 - Parse Transaction
    → 02 - Validate Transaction        (fail → 04 Import Failed)
      → 02 - Duplicate Check           (fail → 04 Import Failed; API error → 04 System Error)
        → 02 - Categorize Transaction  (no category → 04 Import Failed; low confidence → 04 Low Confidence Import, non-blocking; API error → 04 System Error)
          → 03 - Create Transaction    (API error → 04 System Error)
            → 03 - Update Account Balance (confirmation/logging; API error → 04 System Error)
```

Each `01-intake` workflow makes exactly **one** Execute Workflow call, to
`02 - Processing / Parse Transaction` — the rest of the chain cascades
automatically via each stage's own Execute Workflow call to the next stage.
Adding a new import source means: new trigger + payload normalization + one
Execute Workflow call. It does not require touching `02-processing` at all.

Every stage that can call an external HTTP endpoint (Duplicate Check,
Categorize Transaction, Create Transaction, Update Account Balance) uses
native `retryOnFail` (3 attempts, 2s apart) + `continueOnFail`, checks the
response status via a `Success?` IF node, and routes failures to
`04 - Notifications / System Error` with `{ workflow, message, statusCode }`
context. `chatId` flows through the entire pipeline from whichever intake
channel started it, so `Import Failed` / `Low Confidence Import` reply into
the originating Telegram chat automatically when applicable.

## Prerequisite: service API key auth (code changes already applied)

Most of the endpoints above require an Auth.js browser session. To make them
callable by n8n, this session added a `ServiceApiKey` model + auth layer to
the app itself:

- `prisma/schema.prisma` — `ServiceApiKey` model, `AuditAction`/
  `AuditEntityType` enum values. **Migration not yet run** — see below.
- `src/server/services/service-api-key.service.ts` — generate/rotate/revoke/
  resolve, mirrors the existing `ImportSettingService` token pattern
  (SHA-256 hashed, timing-safe compare, never stores plaintext). Scopes:
  `transactions:write`, `transactions:read`, `debts:write`, `savings:write`,
  `remittances:write`, `categories:read`, `accounts:read`,
  `automation:trigger`.
- `src/lib/service-auth.ts` — `resolveRequestAuth(req, scope)`: tries the
  browser session first, falls back to `Authorization: Bearer bf_svc_...`,
  checks the required scope.
- `src/app/api/settings/service-api-key/route.ts` (+ `[id]/route.ts`) —
  session-gated key management (list/generate/rotate/revoke).
- Accepts **either** auth method — `GET` and `POST` on: `/api/transactions`,
  `/api/debts/[id]/payments`, `/api/savings/[id]/transactions`,
  `/api/remittances`; `GET` on `/api/categories`, `/api/accounts`; plus
  `POST /api/recurring/evaluate`, `GET /api/monthly-rollover/preview`,
  `POST /api/monthly-rollover/confirm`, `POST /api/notifications/evaluate`.

**You still need to run the migration** — this session has no access to your
local Postgres instance:

```bash
npx prisma migrate dev --name add_service_api_key
npx prisma generate
```

(`npx prisma generate` clears the current TypeScript errors in
`service-api-key.service.ts` — they're stale Prisma Client types, not a code
bug; the model exists in the schema but the client hasn't been regenerated.)

### Generating a key for n8n

While signed in to BudgetFlow (browser session), call:

```bash
curl -X POST http://localhost:3000/api/settings/service-api-key \
  -H "Content-Type: application/json" \
  -H "Cookie: <your session cookie>" \
  -d '{"name":"n8n production","scopes":["transactions:write","transactions:read","debts:write","savings:write","remittances:write","categories:read","accounts:read","automation:trigger"]}'
```

The response's `key` field (`bf_svc_...`) is shown **exactly once** — store it
as the `BUDGETFLOW_SERVICE_API_KEY` n8n environment variable. Scopes are
least-privilege: only grant what a given key actually needs. To rotate:
`PATCH /api/settings/service-api-key/[id]`; to revoke:
`DELETE .../[id]`.

**The categorize/create-transaction pipeline (02-processing,
03-budgetflow-api-client) and the scheduling workflows operate as a single
BudgetFlow user** — whoever generated the service key. `01-intake/sms-import`
is the exception: it's multi-tenant. It doesn't hold any per-user credential
itself — whatever forwards a user's bank SMS to it (an iPhone Shortcut, a
forwarding app, etc.) includes that user's own `bf_import_...` token in the
`Authorization` header of the webhook call, and `sms-import.json` forwards
that header unchanged to `POST /api/imports/sms`, which resolves it to the
right account. One shared workflow, no per-user n8n configuration needed —
each user just needs their own token from Settings → Generate Token.

### Two different credentials — don't mix them up

| Credential | Used by | Grants |
|---|---|---|
| `BUDGETFLOW_SERVICE_API_KEY` (`bf_svc_...`) | 02-processing, 03-budgetflow-api-client, 06-scheduling-orchestration | Scoped read/write access to one user's transactions/debts/savings/remittances/categories/accounts + automation triggers |
| `bf_import_...` (per-user, forwarded per-request — not an n8n env var) | 01-intake/sms-import (forwarded through), 01-intake/email-import-gmail | Only `POST /api/imports/sms` — full parse/dedup/categorize pipeline (the app's own, not the 02-processing one) |
| `CRON_SECRET` | 06-scheduling-orchestration/system-health-check | Only `GET /api/cron/health` (all-user sweep) |
| `IMPORT_CLEANUP_SECRET` | 06-scheduling-orchestration/import-retention-cleanup | Only `POST /api/system/import-cleanup` |

Each `bf_import_...` token is generated the same way as today, via
`POST /api/settings/import-token` (unchanged, pre-existing) — self-serve,
one per user. `CRON_SECRET` and `IMPORT_CLEANUP_SECRET` are plain env vars
you set yourself.

## n8n environment variables to configure

| Variable | Example | Notes |
|---|---|---|
| `BUDGETFLOW_BASE_URL` | `https://budgetflow.yourdomain.com` | No trailing slash |
| `BUDGETFLOW_SERVICE_API_KEY` | `bf_svc_...` | From the settings endpoint above; needs the full scope list |
| `BUDGETFLOW_IMPORT_TOKEN` | `bf_import_...` | Only needed if you enable email-import-gmail (a single-user path). `sms-import.json` does NOT use this env var — it forwards whatever `bf_import_...` token the caller sent, per-request, per-user. |
| `CRON_SECRET` | matches app's env | For System Health Check |
| `IMPORT_CLEANUP_SECRET` | matches app's env | For Import Retention Cleanup |
| `TELEGRAM_BOT_TOKEN` | matches app's env | Used only for outbound `sendMessage` calls from 04-notifications — safe to reuse the app's token for this, since it only calls the Telegram API, it doesn't register a webhook |
| `N8N_OPS_TELEGRAM_CHAT_ID` | your chat/group id | A channel you control for automation alerts, separate from per-user chats |

## Importing

1. In n8n: **Workflows → Import from File**, import in dependency order:
   `05-utilities/` → `04-notifications/` → `03-budgetflow-api-client/` →
   `02-processing/` → `01-intake/` → `06-scheduling-orchestration/`.
2. Every **Execute Workflow** node was generated before any workflow had a
   real n8n-assigned ID, so each one needs its target re-selected once after
   import: open the node, use the workflow picker dropdown, and pick the
   matching workflow by name (they're named e.g. "02 - Processing / Validate
   Transaction"). This is a one-time fixup per node — there are quite a few
   of them in `02-processing` and `01-intake` given the chained design.
3. Set the environment variables above (n8n **Settings → Environments**, or
   your `.env` for self-hosted).
4. `01-intake/email-import-gmail.json` stays inactive until you add Gmail
   OAuth credentials and a sender filter to its trigger node.
6. Activate the schedule-triggered workflows in `06-scheduling-orchestration/`
   once you've confirmed a manual test run works end-to-end.
7. Test the pipeline manually before activating intake: `POST` a test SMS to
   `.../webhook/budgetflow/sms-import` with `{"body":"AED 45.50 at Carrefour
   today"}` and confirm a transaction appears in BudgetFlow.
8. Wire up the crash safety net: open every workflow **except** those in
   `04-notifications` and `05-utilities` (so 01-intake, 02-processing,
   03-budgetflow-api-client, 06-scheduling-orchestration) → **Settings**
   (gear icon, top right) → **Error Workflow** → select
   `04 - Notifications / Error Trigger`. One-time, per workflow — n8n has no
   single instance-wide default, so this doesn't batch. See
   "Error handling & retries" below for what this buys you over the
   explicit `System Error` calls already in the pipeline.

## Error handling & retries

Every HTTP call to the BudgetFlow API uses n8n's native `retryOnFail`
(3 attempts, 2s apart) plus `continueOnFail` so a failure routes to an
explicit `Success?` branch instead of crashing the execution. Failures call
**04 - Notifications / System Error**, which logs via
**05 - Utilities / Logger** and pings `N8N_OPS_TELEGRAM_CHAT_ID`. The
**05 - Utilities / Retry Handler** workflow exists for the minority of cases
needing custom backoff (e.g. respecting a `Retry-After` header) — most
workflows don't need it.

That covers every *designed* failure point — an HTTP call that comes back
non-2xx. It does not cover a workflow crashing somewhere it wasn't expected
to: a Code node throwing, a malformed trigger payload, a timeout, an
unhandled exception mid-execution. Those fail silently unless something is
watching for them.

**04 - Notifications / Error Trigger** is that watcher. It starts with
n8n's built-in Error Trigger node, which only fires when a workflow names it
as *that workflow's* Error Workflow (Settings → Error Workflow — see step 8
under Importing). Any workflow that crashes anywhere fires this one instead
of failing silently; it reformats whatever n8n hands it (workflow name, last
node executed, error message, execution URL) into the same
`{ workflow, message, statusCode, context }` shape `System Error` already
expects, and calls straight into it — so there's still exactly one place
that talks to Telegram, not two.

`02 - Categorize Transaction` uses a fan-out pattern worth knowing about: its
low-confidence check runs in parallel with the main resolved/not-resolved
gate, so a low-confidence categorization still creates the transaction (and
separately notifies you to review it) rather than blocking the import.

## Known trade-offs / fast-follows not done in this pass

- `02 - Parse Transaction` is a generic, bank-agnostic regex parser (amount,
  currency, date, income/expense guess). It will be far less accurate than
  the app's own bank-specific parsing in `importService.processSms()` for
  anything but simple, clearly-formatted text. Extend its keyword/regex
  rules as you encounter real SMS formats.
- `02 - Categorize Transaction`'s keyword map is a starting-point default
  (groceries/dining/transport/utilities/entertainment/health/salary) —
  edit it to match your actual category names.
- `02 - Duplicate Check` matches on amount + same calendar day only, not a
  fuzzy description match — intentionally simple, may produce false
  negatives for two genuinely different same-amount, same-day transactions.
- Transactions created via n8n are tagged with the default `TransactionOrigin`
  (`MANUAL`) since `origin` isn't yet plumbed through `POST /api/transactions`.
  Adding an `AUTOMATION` origin end-to-end would improve traceability but
  touches the core transaction-creation path — flag if you want it as a
  follow-up.
- `record-debt-payment.json` and `record-savings-transaction.json` assume the
  payload shape from `DebtPayment`/`SavingTransaction` DB fields; double-check
  against `recordPaymentSchema` / `recordSavingTransactionSchema` if those
  evolve.
- `manual-csv-bulk-import.json` now also triggers `Update Account Balance`
  per row (via the shared `Create Transaction` chain) — an extra `GET
  /api/accounts` call per row. Harmless but adds latency on large CSVs.
