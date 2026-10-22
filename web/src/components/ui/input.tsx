import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(function Input({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        "h-9 w-full rounded-[10px] bg-surface-2 px-3 text-[13.5px] text-fg shadow-[0_0_0_1px_var(--line)] outline-none transition-shadow placeholder:text-fg-3 focus:shadow-[0_0_0_1px_var(--accent),0_0_0_4px_var(--accent-soft)]",
        className,
      )}
      {...props}
    />
  );
});
