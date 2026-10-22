import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { Outlet, useLocation } from "react-router";
import { CommandPalette } from "./CommandPalette";
import { MobileHeader, MobileTabBar } from "./MobileNav";
import { Sidebar } from "./Sidebar";

export function Shell() {
  const [palette, setPalette] = useState(false);
  const { pathname } = useLocation();
  return (
    <div className="flex min-h-dvh">
      <Sidebar onSearch={() => setPalette(true)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileHeader onSearch={() => setPalette(true)} />
        <main className="mx-auto w-full max-w-[1240px] flex-1 px-4 pt-5 pb-28 md:px-8 md:pt-8 md:pb-12">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={pathname.split("/")[1]}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <MobileTabBar />
      <CommandPalette open={palette} onOpenChange={setPalette} />
    </div>
  );
}
