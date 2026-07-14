import { PageHeader } from "@/components/shared/page-header";
import { SettingsClient } from "./settings-client";

export default function SettingsPage() {
  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <PageHeader
        title="Settings"
        description="Configure your salary details, notification preferences, and application themes."
      />
      <SettingsClient />
    </div>
  );
}
