# Architecture Decision Records (ADR)

This log tracks the chronological record of key decisions made during development.

---

## ADR 1: Unified API Response Contract
* **Status**: Approved
* **Context**: API endpoints had varying success and error structures, leading to inconsistent front-end parsing code.
* **Decision**: Adopt the `{ data: T | null, error: { code: string, message: string } | null }` contract.
* **Consequences**: Standardized response processing and simplified TypeScript mapping.

---

## ADR 2: Asia/Dubai Timezone Queries
* **Status**: Approved
* **Context**: PostgreSQL stores datetime columns in UTC, shifting days if parsed in local server offsets.
* **Decision**: Explicitly calculate query ranges using the `Asia/Dubai` timezone offset (+4). All boundaries are generated on the server using absolute offset conversions before executing SQL queries.
* **Consequences**: Consistent daily budget and transaction margins.

---

## ADR 3: Pure Calculations Engine
* **Status**: Approved
* **Context**: Financial calculations were scattered inside services and repositories, risking float rounding errors.
* **Decision**: Consolidate calculations inside a standalone pure-functions engine using `decimal.js`. React UI pages cannot perform computations.
* **Consequences**: High-precision calculations and isolated, easily testable logic.
