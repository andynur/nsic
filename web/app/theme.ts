// Color theme (DESIGN.md §2): light by default, dark only when the user picks it. Stored per browser.
// The pre-paint script in web/index.html reads the same key so a saved dark theme never flashes light.
import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark";
export const THEME_KEY = "nsic.theme";

const listeners = new Set<() => void>();
let current: Theme = read();

function read(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

function apply(t: Theme) {
  if (t === "dark") document.documentElement.dataset.theme = "dark";
  else delete document.documentElement.dataset.theme;
}

export function setTheme(t: Theme) {
  current = t;
  apply(t);
  try {
    localStorage.setItem(THEME_KEY, t);
  } catch {
    /* storage unavailable: the choice lasts for this page only */
  }
  for (const l of listeners) l();
}

// Keep several open tabs in sync.
addEventListener("storage", (e: StorageEvent) => {
  if (e.key !== THEME_KEY) return;
  current = e.newValue === "dark" ? "dark" : "light";
  apply(current);
  for (const l of listeners) l();
});

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useTheme(): [Theme, (t: Theme) => void] {
  return [useSyncExternalStore(subscribe, () => current), setTheme];
}
