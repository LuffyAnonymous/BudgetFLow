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
  LucideKey,
  LucideCopy,
  LucideRotateCw,
  LucideTrash2,
  LucideShieldCheck,
  LucideSend,
  LucideUnlink,
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

  // Token state
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);
  const [tokenWarning, setTokenWarning] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState("");
  const [copied, setCopied] = useState(false);

  // Token Status Query
  const { data: tokenStatus, isLoading: isLoadingToken } = useQuery({
    queryKey: ["import-token-status"],
    queryFn: async () => {
      const res = await fetch("/api/settings/import-token/status");
      const json = await res.json();
      return json.data; // { isActive: boolean, expiresAt: string | null, lastUsedAt: string | null }
    },
  });

  // Generate Token Mutation
  const generateTokenMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/settings/import-token", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to generate token");
      return json.data;
    },
    onSuccess: (data) => {
      setGeneratedToken(data.token);
      setTokenWarning(data.warning);
      setTokenError("");
      queryClient.invalidateQueries({ queryKey: ["import-token-status"] });
    },
    onError: (err: Error) => {
      setTokenError(err.message);
    },
  });

  // Rotate Token Mutation
  const rotateTokenMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/settings/import-token", { method: "PATCH" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to rotate token");
      return json.data;
    },
    onSuccess: (data) => {
      setGeneratedToken(data.token);
      setTokenWarning(data.warning);
      setTokenError("");
      queryClient.invalidateQueries({ queryKey: ["import-token-status"] });
    },
    onError: (err: Error) => {
      setTokenError(err.message);
    },
  });

  // Revoke Token Mutation
  const revokeTokenMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/settings/import-token", { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to revoke token");
      return json.data;
    },
    onSuccess: () => {
      setGeneratedToken(null);
      setTokenWarning(null);
      setTokenError("");
      queryClient.invalidateQueries({ queryKey: ["import-token-status"] });
    },
    onError: (err: Error) => {
      setTokenError(err.message);
    },
  });

  // Telegram Link Status Query
  const [linkCode, setLinkCode] = useState<string | null>(null);
  const { data: telegramStatus, isLoading: isLoadingTelegram } = useQuery({
    queryKey: ["telegram-link-status"],
    queryFn: async () => {
      const res = await fetch("/api/settings/telegram-link");
      const json = await res.json();
      return json.data; // { isLinked: boolean }
    },
  });

  const generateLinkCodeMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/settings/telegram-link", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to generate a link code");
      return json.data;
    },
    onSuccess: (data) => setLinkCode(data.code),
  });

  const unlinkTelegramMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/settings/telegram-link", { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to unlink Telegram");
      return json.data;
    },
    onSuccess: () => {
      setLinkCode(null);
      queryClient.invalidateQueries({ queryKey: ["telegram-link-status"] });
    },
  });

  // Import Settings Query
  const { data: importSettings, isLoading: isLoadingImportSettings } = useQuery({
    queryKey: ["import-settings"],
    queryFn: async () => {
      const res = await fetch("/api/settings/import");
      const json = await res.json();
      return json.data; // { enabled: boolean, autoImportSalary: boolean, ... }
    },
  });

  // Update Import Settings Mutation
  const updateImportSettingsMutation = useMutation({
    mutationFn: async (payload: { enabled: boolean }) => {
      const res = await fetch("/api/settings/import", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to update import settings");
      return json.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["import-settings"] });
    },
    onError: (err: Error) => {
      setTokenError(err.message);
    },
  });

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
                className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:border-indigo-500 focus:outline-none transition-all"
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
                <span className="text-sm text-slate-400">Upcoming Payment Reminders</span>
              </label>

              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={overduePref}
                  onChange={(e) => setOverduePref(e.target.checked)}
                  className="rounded border-slate-800 bg-slate-950 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-sm text-slate-400">Overdue Reminders warnings</span>
              </label>

              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={budgetPref}
                  onChange={(e) => setBudgetPref(e.target.checked)}
                  className="rounded border-slate-800 bg-slate-950 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-sm text-slate-400">Budget Nearing/Exceeded limits (80%, 100%)</span>
              </label>

              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={savingsPref}
                  onChange={(e) => setSavingsPref(e.target.checked)}
                  className="rounded border-slate-800 bg-slate-950 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-sm text-slate-400">Savings Goal Reached alerts</span>
              </label>

              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={rolloverPref}
                  onChange={(e) => setRolloverPref(e.target.checked)}
                  className="rounded border-slate-800 bg-slate-950 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-sm text-slate-400">Monthly Rollover Availability</span>
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

        {/* API Import Token Section */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 backdrop-blur-sm space-y-6">
          <div className="flex items-center gap-3 border-b border-slate-800 pb-4">
            <LucideKey className="h-5 w-5 text-indigo-400" />
            <div>
              <h2 className="text-lg font-semibold text-white">SMS Import Credentials</h2>
              <p className="text-xs text-slate-400">Generate access tokens for the automated bank SMS endpoint.</p>
            </div>
          </div>

          {/* Import Engine Toggle */}
          <div className="flex items-center gap-3 bg-slate-950 p-4 rounded-xl border border-slate-800">
            <label className="flex items-center gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={importSettings?.enabled ?? false}
                onChange={(e) => {
                  updateImportSettingsMutation.mutate({ enabled: e.target.checked });
                }}
                disabled={isLoadingImportSettings || updateImportSettingsMutation.isPending}
                className="rounded border-slate-800 bg-slate-950 text-indigo-600 focus:ring-indigo-500 h-4 w-4 cursor-pointer"
              />
              <div>
                <p className="text-sm font-semibold text-white">Enable Import Engine</p>
                <p className="text-xs text-slate-400">Allow receiving automated transactions via SMS integrations.</p>
              </div>
            </label>
          </div>

          {tokenError && (
            <div className="flex items-center gap-2 rounded-xl bg-red-500/10 p-3 text-xs font-semibold text-red-400 border border-red-500/20">
              <LucideAlertCircle className="h-4 w-4 flex-shrink-0" />
              {tokenError}
            </div>
          )}

          {generatedToken && (
            <div className="rounded-xl bg-indigo-500/10 border border-indigo-500/20 p-4 space-y-3">
              <p className="text-xs text-indigo-400 font-bold uppercase tracking-wider">Generated Access Token</p>
              <div className="flex items-center gap-2 bg-slate-950 p-3 rounded-lg border border-slate-800">
                <code className="text-xs text-indigo-300 font-mono break-all flex-1 select-all">
                  {generatedToken}
                </code>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(generatedToken);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="p-1.5 rounded-md hover:bg-slate-800 text-slate-400 hover:text-white transition-all"
                  title="Copy to clipboard"
                >
                  <LucideCopy className="h-4 w-4" />
                </button>
              </div>
              {copied && (
                <p className="flex items-center gap-1 text-[10px] text-emerald-400 font-semibold">
                  <LucideCheckCircle2 className="h-3 w-3" aria-hidden="true" /> Copied to clipboard!
                </p>
              )}
              <p className="flex items-start gap-1 text-[10px] text-amber-400 leading-normal">
                <LucideAlertCircle className="h-3 w-3 mt-0.5 shrink-0" aria-hidden="true" />
                {tokenWarning || "Copy this token now! It will not be shown again for security reasons."}
              </p>
            </div>
          )}

          {isLoadingToken ? (
            <div className="h-20 w-full animate-pulse rounded-xl bg-slate-950 border border-slate-800" />
          ) : tokenStatus?.isActive ? (
            <div className="space-y-4">
              <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-4 space-y-2">
                <div className="flex items-center gap-2 text-emerald-400 font-semibold text-xs">
                  <LucideShieldCheck className="h-4 w-4" />
                  <span>Token Active & Secure</span>
                </div>
                <div className="text-[11px] text-slate-400 space-y-1">
                  {tokenStatus.lastUsedAt && (
                    <p>
                      Last Used:{" "}
                      <span className="text-slate-400">
                        {new Date(tokenStatus.lastUsedAt).toLocaleString()}
                      </span>
                    </p>
                  )}
                  {tokenStatus.expiresAt && (
                    <p>
                      Expires:{" "}
                      <span className="text-slate-400">
                        {new Date(tokenStatus.expiresAt).toLocaleDateString()}
                      </span>
                    </p>
                  )}
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    if (confirm("Are you sure you want to rotate this token? The previous token will stop working immediately.")) {
                      rotateTokenMutation.mutate();
                    }
                  }}
                  disabled={rotateTokenMutation.isPending}
                  className="flex-1 flex items-center justify-center gap-1.5 rounded-xl border border-indigo-500/30 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 py-2.5 text-xs font-bold transition-all disabled:opacity-50"
                >
                  <LucideRotateCw className={`h-3.5 w-3.5 ${rotateTokenMutation.isPending ? "animate-spin" : ""}`} />
                  Rotate
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (confirm("Are you sure you want to revoke this token? SMS imports will fail until a new token is generated.")) {
                      revokeTokenMutation.mutate();
                    }
                  }}
                  disabled={revokeTokenMutation.isPending}
                  className="flex-1 flex items-center justify-center gap-1.5 rounded-xl border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 text-red-400 py-2.5 text-xs font-bold transition-all disabled:opacity-50"
                >
                  <LucideTrash2 className="h-3.5 w-3.5" />
                  Revoke
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-xs text-slate-400 leading-normal">
                No active import token generated. Generate a token to connect external iOS Shortcuts or bank webhooks.
              </p>
              <button
                type="button"
                onClick={() => generateTokenMutation.mutate()}
                disabled={generateTokenMutation.isPending}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white transition-all hover:bg-indigo-500 shadow-md shadow-indigo-600/20 disabled:opacity-50"
              >
                <LucideKey className="h-4 w-4" />
                {generateTokenMutation.isPending ? "Generating..." : "Generate Token"}
              </button>
            </div>
          )}
        </div>

        {/* Telegram Linking Section */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 backdrop-blur-sm space-y-6">
          <div className="flex items-center gap-3 border-b border-slate-800 pb-4">
            <LucideSend className="h-5 w-5 text-indigo-400" />
            <div>
              <h2 className="text-lg font-semibold text-white">Telegram</h2>
              <p className="text-xs text-slate-400">Forward bank SMS text to the bot and it&apos;s imported automatically.</p>
            </div>
          </div>

          {isLoadingTelegram ? (
            <div className="h-16 w-full animate-pulse rounded-xl bg-slate-950 border border-slate-800" />
          ) : telegramStatus?.isLinked ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-4 text-emerald-400 font-semibold text-xs">
                <LucideShieldCheck className="h-4 w-4" />
                <span>Telegram chat connected</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (confirm("Disconnect Telegram? You'll need to link it again to resume forwarding SMS text there.")) {
                    unlinkTelegramMutation.mutate();
                  }
                }}
                disabled={unlinkTelegramMutation.isPending}
                className="w-full flex items-center justify-center gap-1.5 rounded-xl border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 text-red-400 py-2.5 text-xs font-bold transition-all disabled:opacity-50"
              >
                <LucideUnlink className="h-3.5 w-3.5" />
                Disconnect
              </button>
            </div>
          ) : linkCode ? (
            <div className="rounded-xl bg-indigo-500/10 border border-indigo-500/20 p-4 space-y-2">
              <p className="text-xs text-indigo-400 font-bold uppercase tracking-wider">Link Code</p>
              <code className="block text-2xl text-indigo-300 font-mono tracking-widest">{linkCode}</code>
              <p className="text-[11px] text-slate-400 leading-normal">
                Message the bot <span className="font-mono text-slate-300">/link {linkCode}</span> within 10 minutes to connect this chat.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-xs text-slate-400 leading-normal">
                Not connected. Generate a code, then send it to the bot to link your Telegram chat.
              </p>
              <button
                type="button"
                onClick={() => generateLinkCodeMutation.mutate()}
                disabled={generateLinkCodeMutation.isPending}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white transition-all hover:bg-indigo-500 shadow-md shadow-indigo-600/20 disabled:opacity-50"
              >
                <LucideSend className="h-4 w-4" />
                {generateLinkCodeMutation.isPending ? "Generating..." : "Connect Telegram"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
