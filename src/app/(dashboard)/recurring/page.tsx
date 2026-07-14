import { RecurringClient } from "./recurring-client";

export const metadata = {
  title: "Recurring Rules | BudgetFlow",
  description: "Configure automated ledger events and upcoming reminder rules.",
};

export default function RecurringPage() {
  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <RecurringClient />
    </div>
  );
}
