# Finance Calculations & Rules

This document details the equations and strict rules governing calculations in BudgetFlow.

## 1. Timezone Date Boundaries (`Asia/Dubai` UTC+4)
To avoid shifting dates across database records, the start and end of months are calculated explicitly:
* **Timezone Offset**: $UTC + 4$ hours.
* **Month Start Range (inclusive)**: The local 1st day of the month at 00:00:00. This is translated to UTC by subtracting 4 hours:
  $$\text{UTC Start} = \text{Date.UTC}(YYYY, MM - 1, 1, 0, 0, 0) - 4\text{ hours}$$
* **Month End Range (exclusive)**: The local 1st day of the next month at 00:00:00.
  $$\text{UTC Next Month Start} = \text{Date.UTC}(YYYY, MM, 1, 0, 0, 0) - 4\text{ hours}$$

## 2. Cash Flow Equations
Planned and actual values are calculated separately to prevent projection leakage.

### Actual Cash Flow
$$\text{Remaining Actual Cash} = \text{Actual Income} - \text{Actual Expenses} - \text{Actual Savings} - \text{Actual Remittances} - \text{Actual Debt Payments}$$
* **Actual Income**: Sum of all recorded transactions with `type = INCOME`.
* **Actual Expenses**: Sum of all recorded transactions with `type = EXPENSE`.
* **Actual Savings**: Sum of savings goal transaction deposits (Milestone 3).
* **Actual Debt Payments**: Sum of recorded debt payments (Milestone 3).

### Planned Allocation
$$\text{Unallocated Plan Margin} = \text{Monthly Salary Plan} - \sum \text{Planned Allocations}$$
$$\sum \text{Planned Allocations} = \text{Planned Expenses} + \text{Planned Savings} + \text{Planned Remittance} + \text{Planned Debt}$$

---

## 3. Combined Food Allowance
* **Food Grouping**: Category records with `budgetGroupKey = "FOOD"` (default seeded: *Food*, *Groceries*, and *Dining Out*).
* **Spending Roll-up**: All expense transactions belonging to categories within this group are combined under the parent "Food" budget row.
* **Daily Food Allowance Formula**:
  $$\text{Daily Allowance} = \frac{\text{Food Budget Limit} - \text{Combined Food Spending}}{\text{Remaining Calendar Days in Dubai}}$$
  * *Condition*: If food spending exceeds the budget, the daily allowance reports $0.00$ and flags an "overdraft" warning status.
