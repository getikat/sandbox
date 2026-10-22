import { Command } from "cmdk";
import { Dialog } from "radix-ui";
import { Database, Eye, Moon, RefreshCw, Search } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { api } from "../../lib/api";
import { usePrivacy, useTheme } from "../../lib/prefs";
import { useInvalidateData, useStatus } from "../../lib/queries";
import { NAV, SETTINGS } from "./nav";

function Row({
  icon,
  children,
  onSelect,
  hint,
}: {
  icon: ReactNode;
  children: ReactNode;
  onSelect: () => void;
  hint?: string;
}) {
  return (
    <Command.Item
      onSelect={onSelect}
      className="flex h-10 cursor-default items-center gap-3 rounded-[10px] px-3 text-[13.5px] text-fg-2 data-[selected=true]:bg-surface-2 data-[selected=true]:text-fg dark:data-[selected=true]:bg-surface-3 [&_svg]:size-4 [&_svg]:text-fg-3"
    >
      {icon}
      <span className="flex-1">{children}</span>
      {hint && <span className="text-[11.5px] text-fg-3">{hint}</span>}
    </Command.Item>
  );
}

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const navigate = useNavigate();
  const [privacy, setPrivacy] = usePrivacy();
  const [, setTheme, resolved] = useTheme();
  const { data: status } = useStatus();
  const invalidate = useInvalidateData();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  const go = (to: string) => {
    onOpenChange(false);
    navigate(to);
  };
  const run = (fn: () => void | Promise<unknown>) => async () => {
    onOpenChange(false);
    await fn();
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed top-[14vh] left-1/2 z-50 w-[min(600px,calc(100vw-24px))] -translate-x-1/2 overflow-hidden rounded-[16px] bg-surface shadow-pop outline-none dark:bg-surface-2">
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          <Dialog.Description className="sr-only">
            Search pages and actions
          </Dialog.Description>
          <Command loop>
            <div className="flex items-center gap-3 border-b border-line px-4">
              <Search className="size-4 text-fg-3" />
              <Command.Input
                autoFocus
                placeholder="Search pages and actions…"
                className="h-12 flex-1 bg-transparent text-[14.5px] outline-none placeholder:text-fg-3"
              />
            </div>
            <Command.List className="max-h-[360px] overflow-y-auto p-2">
              <Command.Empty className="py-10 text-center text-[13px] text-fg-3">
                Nothing matches.
              </Command.Empty>
              <Command.Group
                heading="Go to"
                className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-fg-3 [&_[cmdk-group-heading]]:uppercase"
              >
                {[...NAV.flatMap((s) => s.items), SETTINGS].map((item) => {
                  const Icon = item.icon;
                  return (
                    <Row
                      key={item.to}
                      icon={<Icon />}
                      onSelect={() => go(item.to)}
                    >
                      {item.label}
                    </Row>
                  );
                })}
              </Command.Group>
              <Command.Group
                heading="Actions"
                className="mt-1 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-fg-3 [&_[cmdk-group-heading]]:uppercase"
              >
                <Row icon={<RefreshCw />} onSelect={run(api.sync)}>
                  Sync all accounts now
                </Row>
                <Row
                  icon={<Eye />}
                  onSelect={run(() => setPrivacy(!privacy))}
                  hint={privacy ? "On" : "Off"}
                >
                  Hide amounts
                </Row>
                <Row
                  icon={<Moon />}
                  onSelect={run(() =>
                    setTheme(resolved === "dark" ? "light" : "dark"),
                  )}
                >
                  Switch to {resolved === "dark" ? "light" : "dark"} mode
                </Row>
                <Row
                  icon={<Database />}
                  onSelect={run(async () => {
                    await api.setProfile(
                      status?.profile === "demo" ? "real" : "demo",
                    );
                    invalidate();
                  })}
                >
                  {status?.profile === "demo"
                    ? "Switch to my real data"
                    : "Explore the demo"}
                </Row>
              </Command.Group>
            </Command.List>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
