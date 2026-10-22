import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronRight, X } from "lucide-react";
import { motion } from "motion/react";
import { Link } from "react-router";
import { api } from "../lib/api";
import { cn } from "../lib/cn";
import { Card } from "./ui/card";

/** Home's "getting set up" list: each item ticks itself off as Ikat sees it done. */
export function SetupCard() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["setup"], queryFn: api.setup });
  if (!data || data.dismissed) return null;
  const done = data.items.filter((i) => i.done).length;
  const required = data.items.filter((i) => !i.optional);
  if (required.every((i) => i.done) && data.items.every((i) => i.done))
    return null;
  const hide = async () => {
    await api.setSetting("ui.setup.dismissed", true);
    qc.setQueryData(["setup"], { ...data, dismissed: true });
  };
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-3 px-5 pt-4 pb-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-[14px] font-semibold">Getting set up</h3>
          <p className="text-[12.5px] text-fg-3">
            Ikat works most of this out itself — these are the few things worth
            a look.
          </p>
        </div>
        <span className="text-[12.5px] font-medium text-fg-2 num">
          {done} of {data.items.length}
        </span>
        <button
          onClick={hide}
          className="rounded-md p-1 text-fg-3 hover:bg-surface-2 hover:text-fg"
          aria-label="Hide"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="mx-5 mb-2 h-1 overflow-hidden rounded-full bg-surface-3">
        <motion.div
          className="h-full rounded-full bg-accent"
          initial={{ width: 0 }}
          animate={{ width: `${(done / data.items.length) * 100}%` }}
        />
      </div>
      <div className="grid sm:grid-cols-2">
        {data.items.map((i) => (
          <Link
            key={i.id}
            to={i.link}
            className={cn(
              "group flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-surface-2/60",
              i.done && "opacity-60",
            )}
          >
            <span
              className={cn(
                "flex size-5 shrink-0 items-center justify-center rounded-full",
                i.done
                  ? "bg-accent text-white"
                  : "shadow-[inset_0_0_0_1.5px_var(--line-strong)]",
              )}
            >
              {i.done && <Check className="size-3" strokeWidth={3} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium">
                {i.label}
                {i.optional && !i.done && (
                  <span className="ml-1.5 text-[11px] font-normal text-fg-3">
                    optional
                  </span>
                )}
              </span>
              <span className="block truncate text-[12px] text-fg-3">
                {i.detail}
              </span>
            </span>
            {!i.done && (
              <ChevronRight className="size-4 text-fg-3 transition-transform group-hover:translate-x-0.5" />
            )}
          </Link>
        ))}
      </div>
    </Card>
  );
}
