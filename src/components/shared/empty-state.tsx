import type { LucideIcon } from "lucide-react";

interface EmptyStateAction {
  label: string;
  onClick: () => void;
  icon?: LucideIcon;
  className?: string;
}

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: EmptyStateAction;
}

const DEFAULT_ACTION_CLASSES =
  "bg-slate-700 hover:bg-slate-600 text-white";

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  const ActionIcon = action?.icon;

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-800/60">
        <Icon className="h-6 w-6 text-slate-500" aria-hidden="true" />
      </div>
      <h3 className="mt-4 text-sm font-semibold text-slate-200">{title}</h3>
      {description && <p className="mt-1.5 text-sm text-slate-500">{description}</p>}
      {action && (
        <button
          onClick={action.onClick}
          className={`mt-5 inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${
            action.className ?? DEFAULT_ACTION_CLASSES
          }`}
        >
          {ActionIcon && <ActionIcon className="h-4 w-4" aria-hidden="true" />}
          {action.label}
        </button>
      )}
    </div>
  );
}
