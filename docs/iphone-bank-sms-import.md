# iPhone Bank SMS Import — Setup Guide

BudgetFlow can automatically receive your Emirates NBD salary SMS via an iPhone Shortcut.
The Shortcut listens for messages from your bank and forwards them to BudgetFlow using your personal import token.

---

## 1. Generate Your Import Token

1. Open BudgetFlow and go to **Settings → Import Settings**.
2. Click **Generate Import Token**.
3. Copy the token shown — **it will only be displayed once**.
4. Store it securely (e.g. in a password manager). Anyone with this token can import transactions to your account.

Your token format:

```
bf_import_<64 hex characters>
```

> **Keep your token secret.** If it is compromised, revoke it immediately from Settings → Import Settings → Revoke Token.

---

## 2. Configure Import Settings

Before your first import:

1. **Enable import**: toggle **SMS Import Enabled** to on.
2. **Sender allowlist**: add your bank's sender name exactly as it appears on your iPhone (e.g. `ENBD`).
3. **Salary category**: select your `Salary` income category.
4. **Expected currency**: set to `AED` (default).

---

## 3. Create the iPhone Shortcut

### Requirements
- iPhone running iOS 16.4 or later
- Shortcuts app installed
- Automation trigger requires **Allow Untrusted Shortcuts** enabled in Settings → Shortcuts

### Steps

1. Open the **Shortcuts** app.
2. Tap the **Automation** tab → **New Automation**.
3. Select trigger: **Message received**.
   - From: enter the exact sender name (e.g. `ENBD`).
   - Message contains: `has been credited to your account`
   - *(Note)*: You can create separate automations for different transaction types (e.g., purchases, transfers) by adjusting the "Message contains" filter.
4. Tap **Run Immediately** and ensure "Notify When Run" is disabled for silent background operation. Then tap **Next**.
5. Add the action **Get Details of Messages** → select the matched message.
6. Add a **Get Current Date** action.
7. Add a **URL** action. Paste your BudgetFlow webhook URL:
   ```
   https://your-budgetflow-domain.com/api/imports/sms
   ```
   Replace `your-budgetflow-domain.com` with your actual domain.
8. Add a **Get Contents of URL** action:
   - **Method**: `POST`
   - **Headers**:
     - `Authorization`: `Bearer YOUR_TOKEN_HERE`
     - `Content-Type`: `application/json`
     - `Idempotency-Key`: use a **Generate Random UUID** action result
   - **Request Body**: JSON
     ```json
     {
       "sender": "[Sender from step 5]",
       "message": "[Message body from step 5]",
       "receivedAt": "[Current date ISO string]",
       "deviceId": "my-iphone"
     }
     ```
9. Add a **Show Notification** action to display the result (optional but recommended).
10. Tap **Done**.

> **Tip**: Test the Shortcut manually first by running it from the Shortcuts app before the next salary day.

---

## 4. Testing Your First Import

1. Forward your sample salary SMS through the Shortcut.
2. It posts straight to your ledger immediately — check **Transactions**
   for it directly. There is no review or confirm step for bank SMS.
3. Verify:
   - Parsed amount is correct (e.g. AED 5,750.00).
   - The available balance parsed from the SMS (e.g. AED 5,752.56) is captured for reference but is **not** the imported amount.
   - Reference number matches the SMS.
4. Check **Imports** (`/imports`) → the transaction should show your
   confidence tier. If it's tagged "needs a second look" (MEDIUM/LOW
   confidence, or an ambiguous debit/credit direction), double-check the
   amount and category — you'll also get a Telegram notification if you've
   linked a chat (Settings → Telegram).

---

## 5. If Something Looks Wrong

Every SMS import posts as a transaction — there's no separate confirm step
to catch mistakes before they land. If a posted transaction has the wrong
amount, category, or account, edit or delete it directly from
**Transactions**. If the message couldn't be parsed at all (unrecognized
sender, or nothing extractable), it shows up under **Imports** → **Failed**
instead, with no transaction created.

---

## 6. How Auto-Import Works

There's no separate switch to flip — as soon as **SMS Import Enabled** is on
(Settings → Import Settings), every parseable message posts immediately,
regardless of confidence:

- **HIGH confidence** (clear amount, recognized merchant, balance and
  reference present) → posts silently, no flag.
- **MEDIUM/LOW confidence**, or an **ambiguous debit/credit direction**
  (e.g. "Transfer received of AED 500", which could read either way) →
  still posts immediately, but gets tagged "needs a second look" on the
  Imports page and triggers a Telegram notification, so you can correct it
  after the fact instead of being blocked beforehand.
- A message that can't be parsed at all (unrecognized sender, no
  extractable amount) never becomes a transaction — it's recorded as
  **Failed** on the Imports page instead, with a notification either way.

Recognized merchants are matched against a fixed list
(`src/imports/engine/merchant-categorizer.ts`) — expanding that list is how
more of your everyday spending qualifies for a clean HIGH-confidence post.

---

## 7. Revoking the Token

If you lose your token or suspect it was exposed:

1. Go to **Settings → Import Settings**.
2. Click **Revoke Token**.
3. The token is immediately invalidated — no further imports can be submitted with it.
4. Generate a new token and update your Shortcut.

---

## 8. Security Notes

- The import token is transmitted only via HTTPS. Do not use it on non-HTTPS URLs.
- The token is **never** put in the URL — always in the `Authorization: Bearer` header.
- `deviceId` is metadata only. It is not used for authentication.
- BudgetFlow stores only a **redacted version** of the SMS (account numbers masked). The raw SMS is not stored.
- Audit logs record all import events (successful, duplicate, rejected) without storing the SMS body.

---

## 9. Troubleshooting

| Symptom | Likely Cause |
|---|---|
| 401 Unauthorized | Token is revoked, wrong, or missing `Bearer ` prefix |
| 403 Forbidden / 503 Service Unavailable | SMS import not enabled in Settings |
| `REVIEW_REQUIRED` but no import in BudgetFlow | Check sender allowlist — sender must match exactly |
| Amount shows as wrong value | Ensure `SALARY TR REF` is present in the SMS |
| Duplicate submitted | Same reference already imported — safe to ignore |
| Token not working after iPhone restore | Regenerate token and update Shortcut |

---

## Placeholders

Replace these in your Shortcut:

| Placeholder | Replace with |
|---|---|
| `YOUR_TOKEN_HERE` | Your `bf_import_...` token |
| `your-budgetflow-domain.com` | Your actual BudgetFlow URL |
| `my-iphone` | Optional label for your device |

> **Do not commit a real token to any repository or public document.**
