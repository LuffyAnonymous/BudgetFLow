"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  LucideSave,
  LucideLock,
  LucideSliders,
  LucideEye,
  LucideEyeOff,
  LucideCheckCircle2,
  LucideAlertCircle,
} from "lucide-react";

export function SettingsClient() {
  const queryClient = useQueryClient();

  // Queries
  const { data: settingsData, isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const res = await fetch("/api/settings");
      const json = await res.json();
      return json.data;
    },
  });

  // State for forms
  const [nameInput, setNameInput] = useState("");
  const [salaryInput, setSalaryInput] = useState("");
  const [paydayInput, setPaydayInput] = useState("");
  const [currencyInput, setCurrencyInput] = useState("AED");
  const [timezoneInput, setTimezoneInput] = useState("Asia/Dubai");
  const [themeInput, setThemeInput] = useState("system");
  const [pageSizeInput, setPageSizeInput] = useState(10);
  const [foodGroupKeyInput, setFoodGroupKeyInput] = useState("FOOD");
  const [leadDaysInput, setLeadDaysInput] = useState(3);

  // Preference Checkboxes
  const [upcomingPref, setUpcomingPref] = useState(true);
  const [overduePref, setOverduePref] = useState(true);
  const [budgetPref, setBudgetPref] = useState(true);
  const [savingsPref, setSavingsPref] = useState(true);
  const [rolloverPref, setRolloverPref] = useState(true);

  // Password fields
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPass, setShowCurrentPass] = useState(false);
  const [showNewPass, setShowNewPass] = useState(false);
  const [showConfirmPass, setShowConfirmPass] = useState(false);

  // Success/Error Indicators
  const [prefSuccess, setPrefSuccess] = useState("");
  const [prefError, setPrefError] = useState("");
  const [passSuccess, setPassSuccess] = useState("");
  const [passError, setPassError] = useState("");

  // Sync state on successful data load
  const [synced, setSynced] = useState(false);
  if (settingsData && !synced) {
    setNameInput(settingsData.name || "");
    setSalaryInput(settingsData.monthlySalary || "0.00");
    setPaydayInput(settingsData.payday?.toString() || "25");
    setCurrencyInput(settingsData.currency || "AED");
    setTimezoneInput(settingsData.timezone || "Asia/Dubai");
    setThemeInput(settingsData.theme || "system");
    setPageSizeInput(settingsData.defaultPageSize || 10);
    setFoodGroupKeyInput(settingsData.foodGroupKey || "FOOD");
    setLeadDaysInput(settingsData.reminderLeadDays || 3);

    const np = settingsData.notificationPref;
    if (np) {
      setUpcomingPref(np.upcomingPaymentsEnabled ?? true);
      setOverduePref(np.overduePaymentsEnabled ?? true);
      setBudgetPref(np.budgetAlertsEnabled ?? true);
      setSavingsPref(np.savingsAlertsEnabled ?? true);
      setRolloverPref(np.rolloverAlertsEnabled ?? true);
    }
    setSynced(true);
  }

  // Preference Mutation
  const updatePreferencesMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        throw new Error(json.error?.message || "Failed to update preferences.");
      }
      return json.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      setPrefSuccess("Preferences updated successfully!");
      setPrefError("");
      setTimeout(() => setPrefSuccess(""), 4000);
    },
    onError: (err: Error) => {
      setPrefError(err.message);
      setPrefSuccess("");
    },
  });

  // Password Mutation
  const changePasswordMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const res = await fetch("/api/settings/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        throw new Error(json.error?.message || "Failed to change password.");
      }
      return json.data;
    },
    onSuccess: (data) => {
      setPassSuccess(data.message || "Password changed successfully.");
      setPassError("");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setTimeout(() => setPassSuccess(""), 6000);
    },
    onError: (err: Error) => {
      setPassError(err.message);
      setPassSuccess("");
    },
  });

  const handlePreferencesSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updatePreferencesMutation.mutate({
      name: nameInput,
      monthlySalary: salaryInput,
      payday: parseInt(paydayInput, 10),
      currency: currencyInput,
      timezone: timezoneInput,
      theme: themeInput,
      defaultPageSize: parseInt(String(pageSizeInput), 10),
      foodGroupKey: foodGroupKeyInput,
      reminderLeadDays: parseInt(String(leadDaysInput), 10),
      notificationPref: {
        upcomingPaymentsEnabled: upcomingPref,
        overduePaymentsEnabled: overduePref,
        budgetAlertsEnabled: budgetPref,
        savingsAlertsEnabled: savingsPref,
        rolloverAlertsEnabled: rolloverPref,
      },
    });
  };

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setPassError("New passwords do not match.");
      return;
    }
    if (newPassword.length < 8) {
      setPassError("New password must be at least 8 characters long.");
      return;
    }
    changePasswordMutation.mutate({
      currentPassword,
      newPassword,
      confirmPassword,
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-48 w-full animate-pulse rounded-2xl bg-slate-900 border border-slate-800" />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
      {/* Preferences Section */}
      <div className="lg:col-span-2 space-y-6">
        <form
          onSubmit={handlePreferencesSubmit}
          className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 backdrop-blur-sm space-y-6"
        >
          <div className="flex items-center gap-3 border-b border-slate-800 pb-4">
            <LucideSliders className="h-5 w-5 text-indigo-400" />
            <div>
              <h2 className="text-lg font-semibold text-white">General Preferences</h2>
              <p className="text-xs text-slate-400">Configure layout, salary, timezone, and lead parameters.</p>
            </div>
          </div>

          {prefSuccess && (
            <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 p-3 text-xs font-semibold text-emerald-400 border border-emerald-500/20">
              <LucideCheckCircle2 className="h-4 w-4 flex-shrink-0" />
              {prefSuccess}
            </div>
          )}

          {prefError && (
            <div className="flex items-center gap-2 rounded-xl bg-red-500/10 p-3 text-xs font-semibold text-red-400 border border-red-500/20">
              <LucideAlertCircle className="h-4 w-4 flex-shrink-0" />
              {prefError}
            </div>
          )}

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                Display Name
              </label>
              <input
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                required
                className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-2.5 text-sm text-white placeholder-slate-650 focus:border-indigo-500 focus:outline-none transition-all"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                Login Email (Read Only)
              </label>
              <input
                type="text"
                value={settingsData?.email || ""}
                disabled
                className="w-full rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-2.5 text-sm text-slate-500 cursor-not-allowed"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                Monthly Salary Amount
              </label>
              <input
                type="number"
                step="0.01"
                value={salaryInput}
                onChange={(e) => setSalaryInput(e.target.value)}
                required
                className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none transition-all"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                Salary Payday (Day of Month)
              </label>
              <input
                type="number"
                min="1"
                max="31"
                value={paydayInput}
                onChange={(e) => setPaydayInput(e.target.value)}
                required
                className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none transition-all"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                Timezone (IANA)
              </label>
              <select
                value={timezoneInput}
                onChange={(e) => setTimezoneInput(e.target.value)}
                className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none transition-all"
              >
                <option value="Asia/Dubai">Asia/Dubai (GST - UTC+4)</option>
                <option value="Asia/Manila">Asia/Manila (PST - UTC+8)</option>
                <option value="Europe/London">Europe/London (GMT/BST)</option>
                <option value="America/New_York">America/New_York (EST/EDT)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                Default Currency
              </label>
              <select
                value={currencyInput}
                onChange={(e) => setCurrencyInput(e.target.value)}
                className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none transition-all"
              >
                <option value="AED">AED (UAE Dirham)</option>
                <option value="PHP">PHP (Philippine Peso)</option>
                <option value="USD">USD (US Dollar)</option>
                <option value="EUR">EUR (Euro)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                Default Table Page Size
              </label>
              <select
                value={pageSizeInput}
                onChange={(e) => setPageSizeInput(parseInt(e.target.value, 10))}
                className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none transition-all"
              >
                <option value="10">10 Rows</option>
                <option value="20">20 Rows</option>
                <option value="50">50 Rows</option>
                <option value="100">100 Rows</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                Food Budget Category Tag
              </label>
              <input
                type="text"
                value={foodGroupKeyInput}
                onChange={(e) => setFoodGroupKeyInput(e.target.value)}
                required
                className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none transition-all"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                Upcoming Lead Days ({leadDaysInput} days)
              </label>
              <input
                type="range"
                min="0"
                max="30"
                value={leadDaysInput}
                onChange={(e) => setLeadDaysInput(parseInt(e.target.value, 10))}
                className="w-full accent-indigo-500 bg-slate-950 rounded-xl"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                Theme Mode
              </label>
              <select
                value={themeInput}
                onChange={(e) => setThemeInput(e.target.value)}
                className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none transition-all"
              >
                <option value="system">Follow System Preferences</option>
                <option value="light">Light Mode</option>
                <option value="dark">Dark Mode</option>
              </select>
            </div>
          </div>

          {/* Checkboxes */}
          <div className="border-t border-slate-800 pt-6">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">
              In-App Notification Alerts
            </h3>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={upcomingPref}
                  onChange={(e) => setUpcomingPref(e.target.checked)}
                  className="rounded border-slate-800 bg-slate-950 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-sm text-slate-350">Upcoming Payment Reminders</span>
              </label>

              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={overduePref}
                  onChange={(e) => setOverduePref(e.target.checked)}
                  className="rounded border-slate-800 bg-slate-950 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-sm text-slate-350">Overdue Reminders warnings</span>
              </label>

              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={budgetPref}
                  onChange={(e) => setBudgetPref(e.target.checked)}
                  className="rounded border-slate-800 bg-slate-950 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-sm text-slate-350">Budget Nearing/Exceeded limits (80%, 100%)</span>
              </label>

              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={savingsPref}
                  onChange={(e) => setSavingsPref(e.target.checked)}
                  className="rounded border-slate-800 bg-slate-950 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-sm text-slate-350">Savings Goal Reached alerts</span>
              </label>

              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={rolloverPref}
                  onChange={(e) => setRolloverPref(e.target.checked)}
                  className="rounded border-slate-800 bg-slate-950 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-sm text-slate-350">Monthly Rollover Availability</span>
              </label>
            </div>
          </div>

          <div className="flex justify-end border-t border-slate-800 pt-6">
            <button
              type="submit"
              disabled={updatePreferencesMutation.isPending}
              className="flex items-center gap-2 rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white transition-all hover:bg-indigo-500 shadow-md shadow-indigo-600/20 disabled:opacity-50"
            >
              <LucideSave className="h-4 w-4" />
              {updatePreferencesMutation.isPending ? "Saving..." : "Save Preferences"}
            </button>
          </div>
        </form>
      </div>

      {/* Password Section */}
      <div className="space-y-6">
        <form
          onSubmit={handlePasswordSubmit}
          className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 backdrop-blur-sm space-y-6"
        >
          <div className="flex items-center gap-3 border-b border-slate-800 pb-4">
            <LucideLock className="h-5 w-5 text-red-400" />
            <div>
              <h2 className="text-lg font-semibold text-white">Change Password</h2>
              <p className="text-xs text-slate-400">Securely update your access credentials.</p>
            </div>
          </div>

          {passSuccess && (
            <div className="flex flex-col gap-1 rounded-xl bg-emerald-500/10 p-3 text-xs font-semibold text-emerald-400 border border-emerald-500/20">
              <div className="flex items-center gap-2">
                <LucideCheckCircle2 className="h-4 w-4 flex-shrink-0" />
                <span>{passSuccess}</span>
              </div>
              <span className="text-[10px] text-slate-400 mt-1 font-normal leading-relaxed">
                Note: All other active browser sessions have been logged out for security.
              </span>
            </div>
          )}

          {passError && (
            <div className="flex items-center gap-2 rounded-xl bg-red-500/10 p-3 text-xs font-semibold text-red-400 border border-red-500/20">
              <LucideAlertCircle className="h-4 w-4 flex-shrink-0" />
              {passError}
            </div>
          )}

          <div className="space-y-4">
            <div className="relative">
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                Current Password
              </label>
              <input
                type={showCurrentPass ? "text" : "password"}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none transition-all pr-10"
              />
              <button
                type="button"
                onClick={() => setShowCurrentPass(!showCurrentPass)}
                className="absolute right-3 top-9 text-slate-400 hover:text-white"
              >
                {showCurrentPass ? <LucideEyeOff className="h-4 w-4" /> : <LucideEye className="h-4 w-4" />}
              </button>
            </div>

            <div className="relative">
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                New Password
              </label>
              <input
                type={showNewPass ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none transition-all pr-10"
              />
              <button
                type="button"
                onClick={() => setShowNewPass(!showNewPass)}
                className="absolute right-3 top-9 text-slate-400 hover:text-white"
              >
                {showNewPass ? <LucideEyeOff className="h-4 w-4" /> : <LucideEye className="h-4 w-4" />}
              </button>
            </div>

            <div className="relative">
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                Confirm New Password
              </label>
              <input
                type={showConfirmPass ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none transition-all pr-10"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPass(!showConfirmPass)}
                className="absolute right-3 top-9 text-slate-400 hover:text-white"
              >
                {showConfirmPass ? <LucideEyeOff className="h-4 w-4" /> : <LucideEye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="flex justify-end border-t border-slate-800 pt-6">
            <button
              type="submit"
              disabled={changePasswordMutation.isPending}
              className="flex w-full justify-center items-center gap-2 rounded-xl bg-red-650 px-6 py-2.5 text-sm font-semibold text-white transition-all hover:bg-red-600 shadow-md shadow-red-650/20 disabled:opacity-50"
            >
              <LucideLock className="h-4 w-4" />
              {changePasswordMutation.isPending ? "Updating..." : "Change Password"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
