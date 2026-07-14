import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { LucideBell, LucideCheck, LucideInfo, LucideAlertTriangle, LucideX } from "lucide-react";

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  message: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  destinationPath: string | null;
  readAt: string | null;
  createdAt: string;
}

export function NotificationDropdown() {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const queryClient = useQueryClient();

  // Fetch unread notifications
  const { data: notificationsData, isLoading } = useQuery<{ items: NotificationItem[]; totalItems: number }>({
    queryKey: ["notifications", "unread"],
    queryFn: async () => {
      const res = await fetch("/api/notifications?unreadOnly=true&pageSize=5");
      const json = await res.json();
      return json.data;
    },
    refetchInterval: 15000, // auto refetch every 15s
  });

  const notifications = notificationsData?.items || [];
  const unreadCount = notificationsData?.totalItems || 0;

  // Mark all as read mutation
  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/notifications/read-all", { method: "POST" });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  // Mark single as read mutation
  const markReadMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/notifications/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ read: true }),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  // Dismiss single notification
  const dismissMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/notifications/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dismissed: true }),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  // Trigger evaluation
  const evaluateMutation = useMutation({
    mutationFn: async () => {
      await fetch("/api/notifications/evaluate", { method: "POST" });
      await fetch("/api/recurring/evaluate", { method: "POST" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["upcoming-payments"] });
    },
  });

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    evaluateMutation.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleItemClick = async (notif: NotificationItem) => {
    await markReadMutation.mutateAsync(notif.id);
    setIsOpen(false);
    if (notif.destinationPath) {
      router.push(notif.destinationPath);
    }
  };

  const getSeverityIcon = (sev: string) => {
    switch (sev) {
      case "CRITICAL":
        return <LucideAlertTriangle className="h-4 w-4 text-red-500" />;
      case "WARNING":
        return <LucideAlertTriangle className="h-4 w-4 text-amber-500" />;
      default:
        return <LucideInfo className="h-4 w-4 text-blue-500" />;
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell Trigger */}
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-slate-800 text-slate-300 transition-all hover:bg-slate-700 hover:text-white focus:outline-none"
      >
        <LucideBell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-[10px] font-bold text-white ring-2 ring-slate-900 animate-bounce">
            {unreadCount}
          </span>
        )}
      </button>

      {/* Popover Dropdown */}
      {isOpen && (
        <div className="absolute right-0 mt-2 z-50 w-80 md:w-96 rounded-2xl border border-slate-800 bg-slate-900/95 p-4 shadow-2xl backdrop-blur-md">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div>
              <h3 className="font-semibold text-white text-sm">Notifications</h3>
              <p className="text-[10px] text-slate-400">You have {unreadCount} unread alerts</p>
            </div>
            {unreadCount > 0 && (
              <button
                onClick={() => markAllReadMutation.mutate()}
                className="flex items-center gap-1 text-[11px] font-medium text-indigo-400 hover:text-indigo-300 transition-colors"
              >
                <LucideCheck className="h-3 w-3" />
                Mark all read
              </button>
            )}
          </div>

          {/* List Content */}
          <div className="my-3 max-h-64 overflow-y-auto space-y-2 pr-1">
            {isLoading ? (
              <div className="py-8 text-center text-xs text-slate-400">Loading alerts...</div>
            ) : notifications.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400 flex flex-col items-center gap-2">
                <LucideBell className="h-6 w-6 text-slate-600" />
                No new notifications
              </div>
            ) : (
              notifications.map((notif) => (
                <div
                  key={notif.id}
                  className="group relative flex gap-3 rounded-xl bg-slate-950/40 p-3 hover:bg-slate-950 transition-all border border-transparent hover:border-slate-800 cursor-pointer"
                  onClick={() => handleItemClick(notif)}
                >
                  <div className="mt-0.5 flex-shrink-0">{getSeverityIcon(notif.severity)}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-white leading-normal truncate">{notif.title}</p>
                    <p className="text-[10px] text-slate-400 leading-relaxed mt-0.5 break-words">{notif.message}</p>
                    <span className="text-[9px] text-slate-500 mt-1 block">
                      {new Date(notif.createdAt).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      dismissMutation.mutate(notif.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded-md hover:bg-slate-800 text-slate-500 hover:text-red-400 transition-all"
                    title="Dismiss"
                  >
                    <LucideX className="h-3 w-3" />
                  </button>
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-slate-800 pt-2 text-center">
            <button
              onClick={() => {
                evaluateMutation.mutate();
              }}
              className="text-[10px] font-semibold text-slate-400 hover:text-white transition-colors"
            >
              Force Evaluate Alerts
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
