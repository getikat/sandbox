import { useEffect, useSyncExternalStore } from "react";

// Per-device UI preferences. localStorage can throw (private mode, blocked
// storage), so every access is guarded and the app works without it.

type Theme = "system" | "light" | "dark";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

function applyTheme(pref: Theme) {
  const dark =
    pref === "dark" ||
    (pref === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

export function useTheme(): [Theme, (t: Theme) => void, "light" | "dark"] {
  const pref = useSyncExternalStore(
    subscribe,
    () => (read("ikat.theme") as Theme) || "system",
  );
  const resolved = useSyncExternalStore(subscribe, () =>
    document.documentElement.dataset.theme === "dark" ? "dark" : "light",
  );
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (((read("ikat.theme") as Theme) || "system") === "system") {
        applyTheme("system");
        emit();
      }
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const set = (t: Theme) => {
    write("ikat.theme", t);
    applyTheme(t);
    emit();
  };
  return [pref, set, resolved];
}

export function usePrivacy(): [boolean, (v: boolean) => void] {
  const on = useSyncExternalStore(subscribe, () =>
    document.documentElement.classList.contains("privacy"),
  );
  const set = (v: boolean) => {
    write("ikat.privacy", v ? "1" : "0");
    document.documentElement.classList.toggle("privacy", v);
    emit();
  };
  return [on, set];
}
