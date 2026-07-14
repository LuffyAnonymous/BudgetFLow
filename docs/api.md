# API Endpoints

All API routes return a unified JSON response contract:

**Success (HTTP 200/201):**
```json
{
  "data": { ... },
  "error": null
}
```

**Error (HTTP 400/401/404/500):**
```json
{
  "data": null,
  "error": {
    "code": "ERROR_CODE_STRING",
    "message": "User-friendly description of what went wrong."
  }
}
```

---

## 1. Categories
Endpoints to retrieve list of user categories.

### `GET /api/categories`
* **Response Data:** Array of categories `[{ id, name, type, budgetGroupKey }]`.

---

## 2. Transactions
Endpoints to manage the ledger.

### `GET /api/transactions`
* **Query Parameters:**
  - `page` (default 1): page index.
  - `pageSize` (default 10): items per page (max 100).
  - `search`: filters description, notes, and payment method.
  - `categoryId`: filters specific category.
  - `type`: `INCOME` or `EXPENSE`.
* **Response Data:** `{ items: [...], page, pageSize, totalItems, totalPages }`.

### `POST /api/transactions`
* **Request Body:**
  ```json
  {
    "date": "2026-07-11",
    "categoryId": "uuid",
    "description": "Text",
    "amount": "100.00",
    "paymentMethod": "Card",
    "notes": "Optional text",
    "type": "EXPENSE"
  }
  ```
* **Validation Rules:**
  - `amount`: must be greater than zero.
  - `description`: 1-100 characters.
  - `paymentMethod`: 1-50 characters.

### `PUT /api/transactions/[id]`
* **Request Body:** Partial transaction parameters.

### `DELETE /api/transactions/[id]`
* Deletes transaction scoped by ID and User ID.

---

## 3. Budgets
Endpoints to configure plans.

### `GET /api/budgets`
* **Query Parameters:** `month` (format YYYY-MM, defaults to current month).
* **Response Data:** Array of category rows with planned amount, actual spent, remaining margin, progress percentage, and status.

### `POST /api/budgets`
* **Request Body:** `{ categoryId, amount, month }`.
* **Validation:** `amount` must be greater than or equal to zero.

### `POST /api/budgets/copy`
* **Request Body:** `{ sourceMonth, targetMonth }`.
* **Validation:** Months must be valid, different, and target month must have no budgets configured.
