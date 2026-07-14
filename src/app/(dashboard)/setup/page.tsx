import { PageHeader } from "@/components/shared/page-header";
import { SetupClient } from "./setup-client";

export default function SetupPage() {
  return (
    <div className="space-y-6 max-w-2xl mx-auto py-10 animate-in fade-in duration-300">
      <PageHeader
        title="First-Run Setup Guide"
        description="Configure your personal finance parameters, active debts, and automatic bank import sender allowlist."
      />
      <SetupClient />
    </div>
  );
}
