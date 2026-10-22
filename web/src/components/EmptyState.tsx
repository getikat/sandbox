import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export function EmptyState({
  icon,
  title,
  body,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center px-6 py-12 text-center",
        className,
      )}
    >
      {icon && (
        <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-surface-2 text-fg-3 shadow-[0_0_0_1px_var(--line)] [&_svg]:size-5">
          {icon}
        </div>
      )}
      <h3 className="text-[15px] font-semibold">{title}</h3>
      {body && <p className="mt-1.5 max-w-sm text-[13px] text-fg-3">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
