# Session Walkthrough — n8n Automation Build

What happened in this session, what's actually live right now, and exactly how
to pick it back up tomorrow. Nothing in this repo is committed or pushed —
everything described below is local working-directory state.

## TL;DR — resuming tomorrow

Three background processes need restarting (they don't survive a reboot or
terminal close); one Telegram step needs redoing because ngrok's free-tier
URL changes every time it restarts:

```bash
# 1. App
cd /Users/poliga/Desktop/budgetflow && npm run dev &

# 2. n8n (reads secrets from .env automatically)
./n8n/start-n8n-dev.sh &

# 3. ngrok tunnel (only needed for Telegram testing)
ngrok http 3000 &
# then get the new URL:
curl -s http://127.0.0.1:4040/api/tunnels | python3 -c "import json,sys;print(json.load(sys.stdin)['tunnels'][0]['public_url'])"

# 4. Re-register the Telegram webhook with the NEW ngrok URL
curl -X POST "https://api.telegram.org/bot$(grep ^TELEGRAM_BOT_TOKEN .env | cut -d'"' -f2)/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"<NEW_NGROK_URL>/api/integrations/telegram/webhook\",\"secret_token\":\"$(grep ^TELEGRAM_WEBHOOK_SECRET .env | cut -d'"' -f2)\"}"
```

Everything else (workflow definitions, activations, database changes, env
vars) is already durable and needs no action.

## What this session built

A full n8n automation architecture for BudgetFlow's import pipeline —
Intake → Parse → Validate → Duplicate Check → Categorize → Create Transaction
→ Update Account Balance → Notify — plus supporting utilities and
notifications. See `n8n/README.md` for the complete architecture writeup
(folder structure, env var reference, design rationale). This file is the
session log / resume guide; that one is the permanent reference.

## What's durable (already saved, survives a reboot)

- **26 n8n workflow JSON files** in `n8n/workflows/` — the source of truth.
  Already imported into your local n8n instance (SQLite at
  `~/.n8n/database.sqlite`), activated, and cross-linked.
- **App code changes** (uncommitted, in your working tree):
  - `src/lib/service-auth.ts`, `src/server/services/service-api-key.service.ts`,
    `src/app/api/settings/service-api-key/` — the service-key auth layer
  - Read-scope additions (`transactions:read`, `categories:read`,
    `accounts:read`) on the `GET` handlers of `src/app/api/transactions/route.ts`,
    `src/app/api/categories/route.ts`, `src/app/api/accounts/route.ts`
  - `prisma/schema.prisma` + `prisma/migrations/20260728220314_add_service_api_key/`
    — **migration already applied** to your real Neon database
- **`.env`** — all secrets below are saved here (gitignored, never committed):
  `CRON_SECRET`, `IMPORT_CLEANUP_SECRET`, `TELEGRAM_BOT_TOKEN`,
  `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_ALLOWED_CHAT_IDS`,
  `TELEGRAM_CHAT_USER_MAP`, and `N8N_BUDGETFLOW_SERVICE_API_KEY` /
  `N8N_BUDGETFLOW_BASE_URL` (the n8n-side values, prefixed `N8N_` since n8n
  doesn't read this file itself — `start-n8n-dev.sh` sources them for you).
- **ngrok authtoken** — saved to `~/Library/Application Support/ngrok/ngrok.yml`,
  persists across reboots. Only the tunnel *URL* is ephemeral, not the auth.
- **Telegram webhook registration** — persists on Telegram's side until you
  change it, but points at whatever ngrok URL was active when last
  registered. If ngrok restarts with a new URL, the registration goes stale
  until you re-run step 4 above.
- **Database state**: one real user account (`admin@budgetflow.com` / user id
  `84bec043-bff0-470e-9bba-fd81a6800844`) — this turned out to be your only,
  real account, not an isolated test account (see "Important correction" below).

## What's ephemeral (needs restarting)

| Process | Port | Restart command |
|---|---|---|
| Next.js app | 3000 | `npm run dev` |
| n8n | 5678 | `./n8n/start-n8n-dev.sh` |
| ngrok tunnel | — | `ngrok http 3000` (new URL every time on free tier) |

## Important correction made mid-session

Early on I treated `SEED_USER_EMAIL`/`SEED_USER_PASSWORD` as an isolated test
account and ran pipeline tests against it. It turned out to be your **only**
account in this database — real transaction history included. Two test
transactions I created ("at Carrefour today" $45.50, "Coffee at Costa" $12.00)
were deleted once this was caught; your real data is otherwise untouched.
One consequence worth knowing: the `bf_svc_...` service API key generated
during testing is your real key, already saved in `.env` — no separate key
generation needed.

## Bugs found and fixed via live testing

All fixed in both the local workflow JSON files and the live n8n instance:

1. **`executeWorkflowTrigger` nodes** needed `"inputSource": "passthrough"`
   explicitly set — n8n's current version otherwise defaults to expecting
   manually-defined input fields, which broke *every* Execute Workflow call
   until fixed (affected all 26 workflows, including the 17 from before this
   session).
2. **Category type mismatch** in `02-processing/categorize-transaction.json`
   — code assumed category `type` was `EXPENSE`/`INCOME` (matching
   `TransactionType`); it's actually `VARIABLE_EXPENSE`/`FIXED_EXPENSE`/`DEBT`/
   etc. (`CategoryType`, a different enum). Fixed with a proper type-mapping
   table.
3. **Missing `paymentMethod`** in `02-processing/parse-transaction.json` —
   `transactionFormSchema` requires it; Parse Transaction never set it,
   causing every Create Transaction call to fail validation. Now defaults to
   `"Bank Transfer"`.
4. **Logger field-shaping bug** in all three `04-notifications/*.json`
   workflows (pre-existing, not introduced this session) — they called
   `05 - Utilities / Logger` with raw passthrough data instead of shaping it
   into `{level, workflow, message, context}`, so log entries were arriving
   essentially empty. Fixed with an explicit `Format Log Entry` node in each.
5. **n8n's `N8N_BLOCK_ENV_ACCESS_IN_NODE` hardening default** blocks `$env.*`
   access in node expressions — every workflow in this architecture relies on
   `$env.BUDGETFLOW_BASE_URL` / `$env.BUDGETFLOW_SERVICE_API_KEY`. Not a code
   bug, but n8n must always be started with
   `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` (already in `start-n8n-dev.sh`).

## Verified working end-to-end

- **SMS Import webhook** → full pipeline → real transaction created, correctly
  categorized (keyword match on "Carrefour" → Groceries)
- **Duplicate detection** — resending the identical SMS was correctly blocked
- **Manual Import webhook** → correctly categorized via keyword match
  ("coffee" → Dining)
- **Real Telegram integration** (the app's own, not n8n's) — registered via
  ngrok, chat ID mapped to your real user, tested with an actual forwarded
  bank SMS. Correctly identified the bank format, ran the real
  `emirates-nbd-salary-v1` parser, flagged a low-confidence internal-transfer
  match, and held it for manual review instead of auto-posting — the safety
  behavior working as intended.

## Still outstanding / not done

- **Nothing is committed or pushed.** All of the above is local working-tree
  state. When you're ready to deploy, that's a separate explicit step —
  ask and I'll walk through committing/pushing.
- **n8n's own Telegram Import workflow** (`01-intake/telegram-import.json`)
  has no webhook registered — it would need a *second*, different Telegram
  bot to avoid colliding with the app's own bot/webhook (Telegram allows only
  one webhook URL per bot token). Low priority; the app's native Telegram
  integration already covers this channel more capably.
- **`email-import-gmail.json`** stays inactive — needs Gmail OAuth credentials
  it doesn't have.
- Categorize Transaction's keyword map (`groceries`, `dining`, `transport`,
  etc.) is a starting-point default — worth tuning against your actual
  category names/vocabulary over time.

## Quick reference: what to check if something looks broken tomorrow

```bash
# Is everything running?
lsof -iTCP -sTCP:LISTEN -P | grep -E ":3000|:5678|:4040"

# n8n workflow list
n8n list:workflow

# Recent n8n executions (replace API_KEY with the "Cowork" key)
API_KEY=$(sqlite3 ~/.n8n/database.sqlite "SELECT apiKey FROM user_api_keys WHERE label='Cowork';")
curl -s -H "X-N8N-API-KEY: $API_KEY" "http://localhost:5678/api/v1/executions?limit=10"

# App log
tail -f <path to nextdev.log if still running, else just check terminal output>
```
