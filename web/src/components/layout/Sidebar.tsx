import { Eye, EyeOff, Moon, RefreshCw, Search, Sun } from "lucide-react";
import { NavLink } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { cn } from "../../lib/cn";
import { relativeTime } from "../../lib/format";
import { usePrivacy, useTheme } from "../../lib/prefs";
import { keys, useStatus } from "../../lib/queries";
import { Logo } from "../Logo";
import { Tooltip } from "../ui/tooltip";
import { NAV, SETTINGS, type NavItem } from "./nav";

function Item({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        cn(
          "group flex h-8 items-center gap-2.5 rounded-[9px] px-2.5 text-[13.5px] font-medium transition-colors",
          isActive
            ? "bg-surface text-fg shadow-card dark:bg-surface-2"
            : "text-fg-2 hover:bg-surface-2/70 hover:text-fg",
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icon
            className={cn(
              "size-[17px] transition-colors",
              isActive ? "text-accent" : "text-fg-3 group-hover:text-fg-2",
            )}
            strokeWidth={2}
          />
          {item.label}
          {item.app && (
            <span className="ml-auto rounded-md bg-surface-2 px-1.5 py-0.5 text-[10.5px] font-medium text-fg-3">
              iPhone
            </span>
          )}
        </>
      )}
    </NavLink>
  );
}

export function Sidebar({ onSearch }: { onSearch: () => void }) {
  const { data: status } = useStatus();
  const [privacy, setPrivacy] = usePrivacy();
  const [, setTheme, resolved] = useTheme();
  const qc = useQueryClient();
  const sync = async () => {
    await api.sync();
    qc.invalidateQueries({ queryKey: keys.status });
  };

  return (
    <aside className="sticky top-0 flex h-dvh w-[244px] shrink-0 flex-col border-r border-line bg-sidebar px-3 pt-4 pb-3 max-md:hidden">
      <div className="flex items-center justify-between px-2">
        <Logo />
        <div className="flex items-center gap-1">
          {status?.profile === "demo" && (
            <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent">
              Demo
            </span>
          )}
        </div>
      </div>

      <button
        onClick={onSearch}
        className="mt-5 flex h-8 items-center gap-2 rounded-[9px] bg-surface-2/70 px-2.5 text-[13px] text-fg-3 shadow-[0_0_0_1px_var(--line)] transition-colors hover:text-fg-2"
      >
        <Search className="size-4" />
        <span className="flex-1 text-left">Search</span>
        <kbd className="rounded-[5px] bg-surface-3 px-1.5 py-px font-sans text-[10.5px] text-fg-3">
          ⌘K
        </kbd>
      </button>

      <nav className="mt-4 flex flex-1 flex-col gap-5 overflow-y-auto scrollbar-none">
        {NAV.map((section, i) => (
          <div key={i} className="flex flex-col gap-0.5">
            {section.label && (
              <div className="mb-1 px-2.5 text-[11px] font-semibold tracking-wide text-fg-3 uppercase">
                {section.label}
              </div>
            )}
            {section.items.map((item) => (
              <Item key={item.to} item={item} />
            ))}
          </div>
        ))}
      </nav>

      <div className="flex flex-col gap-0.5 border-t border-line pt-3">
        <Item item={SETTINGS} />
        <div className="mt-2 flex items-center justify-between px-1.5">
          <button
            onClick={sync}
            className="flex min-w-0 items-center gap-1.5 rounded-md px-1 py-1 text-[11.5px] text-fg-3 transition-colors hover:text-fg-2"
          >
            <RefreshCw
              className={cn(
                "size-3.5 shrink-0",
                status?.syncing && "animate-spin",
              )}
            />
            <span className="truncate">
              {status?.syncing
                ? "Syncing…"
                : `Synced ${relativeTime(status?.lastSyncAt ?? null)}`}
            </span>
          </button>
          <div className="flex items-center">
            <Tooltip content={privacy ? "Show amounts" : "Hide amounts"}>
              <button
                onClick={() => setPrivacy(!privacy)}
                className="rounded-md p-1.5 text-fg-3 transition-colors hover:bg-surface-2 hover:text-fg"
              >
                {privacy ? (
                  <EyeOff className="size-4" />
                ) : (
                  <Eye className="size-4" />
                )}
              </button>
            </Tooltip>
            <Tooltip content={resolved === "dark" ? "Light mode" : "Dark mode"}>
              <button
                onClick={() => setTheme(resolved === "dark" ? "light" : "dark")}
                className="rounded-md p-1.5 text-fg-3 transition-colors hover:bg-surface-2 hover:text-fg"
              >
                {resolved === "dark" ? (
                  <Sun className="size-4" />
                ) : (
                  <Moon className="size-4" />
                )}
              </button>
            </Tooltip>
          </div>
        </div>
      </div>
    </aside>
  );
}
