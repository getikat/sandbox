import { Eye, EyeOff, LayoutGrid, Search } from "lucide-react";
import { useState } from "react";
import { NavLink, useLocation } from "react-router";
import { cn } from "../../lib/cn";
import { usePrivacy } from "../../lib/prefs";
import { LogoMark } from "../Logo";
import { Sheet } from "../ui/sheet";
import { MOBILE_NAV, NAV, SETTINGS } from "./nav";

export function MobileHeader({ onSearch }: { onSearch: () => void }) {
  const [privacy, setPrivacy] = usePrivacy();
  return (
    <header
      className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-canvas/80 px-4 backdrop-blur-xl md:hidden"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="flex items-center gap-2">
        <LogoMark size={24} />
        <span className="text-[16px] font-semibold tracking-[-0.03em]">
          Ikat
        </span>
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={() => setPrivacy(!privacy)}
          className="rounded-lg p-2 text-fg-2"
          aria-label="Toggle privacy"
        >
          {privacy ? (
            <EyeOff className="size-[18px]" />
          ) : (
            <Eye className="size-[18px]" />
          )}
        </button>
        <button
          onClick={onSearch}
          className="rounded-lg p-2 text-fg-2"
          aria-label="Search"
        >
          <Search className="size-[18px]" />
        </button>
      </div>
    </header>
  );
}

export function MobileTabBar() {
  const [more, setMore] = useState(false);
  const { pathname } = useLocation();
  const inMore = !MOBILE_NAV.some((i) =>
    i.end ? pathname === i.to : pathname.startsWith(i.to),
  );
  const tab =
    "flex flex-1 flex-col items-center gap-0.5 py-2 text-[10.5px] font-medium transition-colors";
  return (
    <>
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-canvas/85 backdrop-blur-xl md:hidden">
        <div className="mx-auto flex max-w-md items-stretch justify-around px-2">
          {MOBILE_NAV.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(tab, isActive ? "text-fg" : "text-fg-3")
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon
                      className={cn("size-[21px]", isActive && "text-accent")}
                      strokeWidth={isActive ? 2.2 : 1.8}
                    />
                    {item.label}
                  </>
                )}
              </NavLink>
            );
          })}
          <button
            onClick={() => setMore(true)}
            className={cn(tab, inMore ? "text-fg" : "text-fg-3")}
          >
            <LayoutGrid
              className={cn("size-[21px]", inMore && "text-accent")}
              strokeWidth={inMore ? 2.2 : 1.8}
            />
            More
          </button>
        </div>
      </nav>
      <Sheet open={more} onOpenChange={setMore} title="Everything">
        <div className="flex flex-col gap-5 overflow-y-auto px-5 pt-1 pb-8">
          {[...NAV, { label: "Ikat", items: [SETTINGS] }].map((section, i) => (
            <div key={i}>
              {section.label && (
                <div className="mb-2 text-[11px] font-semibold tracking-wide text-fg-3 uppercase">
                  {section.label}
                </div>
              )}
              <div className="grid grid-cols-3 gap-2">
                {section.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end}
                      onClick={() => setMore(false)}
                      className={({ isActive }) =>
                        cn(
                          "flex flex-col items-center gap-1.5 rounded-[14px] px-2 py-3 text-center text-[11.5px] font-medium shadow-[0_0_0_1px_var(--line)] transition-colors",
                          isActive
                            ? "bg-accent-soft text-fg"
                            : "bg-surface-2 text-fg-2",
                        )
                      }
                    >
                      <Icon className="size-5 text-accent" />
                      {item.label}
                    </NavLink>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </Sheet>
    </>
  );
}
