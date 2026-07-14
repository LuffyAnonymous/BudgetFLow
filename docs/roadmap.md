# Application Roadmap

This roadmap lists the development milestones for the BudgetFlow personal finance application.

```mermaid
gantt
  title BudgetFlow MVP Roadmap
  dateFormat YYYY-MM-DD
  section Core Engine
  Milestone 1 (Auth & Layout) :done, 2026-07-08, 2026-07-10
  Milestone 2 (Transactions & Budgets) :done, 2026-07-10, 2026-07-11
  section Active Work
  Milestone 3 (Debts & Savings) :active, 2026-07-11, 2026-07-12
  section Future Scope
  Milestone 4 (Remittances & Reports) : 2026-07-12, 2026-07-14
```

## Milestone Overview

### [x] Milestone 1: Authentication & Layout
* Email and password login via Auth.js.
* Redirection proxy validation middleware.
* Responsive dashboard layout structure.

### [x] Milestone 2: Transactions & Budgets
* Transaction ledger CRUD.
* Monthly budget allocation caps.
* actuals spent calculations.
* Dynamic daily food allowance grouping.

### [/] Milestone 3: Debts & Savings (Current)
* Multiple debt balances tracking and payment logs.
* Projected debt schedules using rollover fee math.
* Savings goals tracking (deposits & withdrawals).
* Reconciling payments/deposits with the main ledger.

### [ ] Milestone 4: Remittances & Reports
* Philippines remittance helper with exchange rate conversions and fees.
* Expense category allocation summaries (pie charts, trend indicators).
* PDF statement exports.
