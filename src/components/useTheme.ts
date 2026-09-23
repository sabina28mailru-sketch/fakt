"use client";

import { useCallback, useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function subscribe(cb: () => void) {
  listeners.add(cb);
  const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
  mq?.addEventListener?.("change", cb);
  return () => {
    listeners.delete(cb);
    mq?.removeEventListener?.("change", cb);
  };
}

/** Тёмная ли тема сейчас: явный выбор на <html data-theme> важнее системной настройки. */
function getSnapshot() {
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "dark") return true;
  if (attr === "light") return false;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true;
}

const getServerSnapshot = () => true; // дизайн тёмный по умолчанию

export function useTheme() {
  const isDark = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggle = useCallback(() => {
    const next = isDark ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("fakt-theme", next);
    } catch {
      /* хранилище недоступно — тема всё равно переключится на эту сессию */
    }
    notify();
  }, [isDark]);

  return { isDark, toggle };
}
