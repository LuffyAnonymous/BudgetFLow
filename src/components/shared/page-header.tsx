interface PageHeaderProps {
  title: string;
  description: string;
  action?: React.ReactNode;
}

export function PageHeader({ title, description, action }: PageHeaderProps) {
  return (
    <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
      <div className="space-y-1.5">
        <h2 className="text-2xl font-bold tracking-tight text-white md:text-3xl">
          {title}
        </h2>
        <p className="text-sm text-slate-400">
          {description}
        </p>
      </div>
      {action && (
        <div className="flex items-center gap-3">
          {action}
        </div>
      )}
    </div>
  );
}
