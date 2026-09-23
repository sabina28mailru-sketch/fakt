"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Loader2, Moon, Sparkles, Square, Sun } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatDateRu, weekdayRu } from "@/lib/utils";
import { EASE, T } from "./motion";
import { Wordmark } from "./Nav";
import { Button } from "./ui/Button";

export function TopBar({
  date,
  model,
  running,
  onGenerate,
  onCancel,
  isDark,
  onToggleTheme,
  preview,
  hasToday,
}: {
  date: string;
  model: string;
  running: boolean;
  onGenerate: () => void;
  /** Прерывает активный прогон: abortRef.current?.abort() живёт в App. */
  onCancel: () => void;
  isDark: boolean;
  onToggleTheme: () => void;
  preview: boolean;
  /** Сегодняшний выпуск уже есть — повторный прогон спрашивает подтверждение. */
  hasToday: boolean;
}) {
  const reduce = useReducedMotion();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const mainRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  // Повторная генерация стоит денег и 3–6 минут, поэтому спрашиваем, а не запускаем молча.
  const needsConfirm = hasToday && !preview && !running;

  useEffect(() => {
    if (!confirmOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Escape") return;
      setConfirmOpen(false);
      mainRef.current?.focus();
    };
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popRef.current?.contains(target) || mainRef.current?.contains(target)) return;
      setConfirmOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointerDown);
    };
  }, [confirmOpen]);

  useEffect(() => {
    if (confirmOpen) popRef.current?.focus();
  }, [confirmOpen]);

  const longLabel = preview
    ? "Как это работает"
    : running
      ? "Собираю…"
      : hasToday
        ? "Обновить выпуск"
        : "Сгенерировать выпуск";
  const shortLabel = preview ? "Как работает" : running ? "Собираю…" : hasToday ? "Обновить" : "Сгенерировать";

  const handleMain = () => {
    if (needsConfirm) {
      setConfirmOpen((v) => !v);
      return;
    }
    onGenerate();
  };

  return (
    <header
      className="sticky z-30 flex shrink-0 items-center justify-between gap-3 border-b border-line bg-bg/92 px-4 backdrop-blur md:px-8 xl:px-12"
      style={{ top: "env(safe-area-inset-top, 0px)", height: "var(--bar-top)" }}
    >
      <div className="flex min-w-0 items-center gap-4">
        <div className="lg:hidden">
          <Wordmark />
        </div>
        <div className="hidden min-w-0 flex-col gap-1.5 lg:flex">
          <span className="t-kicker">Сегодня</span>
          <span className="t-meta truncate text-fg uppercase">
            {weekdayRu(date)}, {formatDateRu(date)}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="hidden font-mono text-[10px] text-faint md:inline">{model}</span>

        {running && (
          <Button size="sm" variant="ghost" onClick={onCancel} aria-label="Остановить генерацию" title="Остановить">
            <Square size={14} aria-hidden />
            <span className="hidden sm:inline">Остановить</span>
          </Button>
        )}

        <Button
          size="sm"
          variant="ghost"
          onClick={onToggleTheme}
          aria-label={isDark ? "Включить светлую тему" : "Включить тёмную тему"}
          title={isDark ? "Светлая тема" : "Тёмная тема"}
        >
          {isDark ? <Sun size={16} aria-hidden /> : <Moon size={16} aria-hidden />}
        </Button>

        <div className="relative">
          <Button
            ref={mainRef}
            variant={needsConfirm ? "secondary" : "primary"}
            size="md"
            onClick={handleMain}
            disabled={running}
            aria-haspopup={needsConfirm ? "dialog" : undefined}
            aria-expanded={needsConfirm ? confirmOpen : undefined}
            className="px-3.5 sm:px-4"
          >
            {running ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Sparkles size={16} aria-hidden />}
            <span className="hidden sm:inline">{longLabel}</span>
            <span className="sm:hidden">{shortLabel}</span>
          </Button>

          <AnimatePresence>
            {confirmOpen && needsConfirm && (
              <motion.div
                ref={popRef}
                tabIndex={-1}
                role="dialog"
                aria-label="Повторная генерация выпуска"
                initial={reduce ? false : { opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? undefined : { opacity: 0, y: -4 }}
                transition={{ duration: T.base, ease: EASE }}
                className="card absolute top-[calc(100%+10px)] right-0 z-40 w-[290px] rounded-lg p-4 shadow-[var(--shadow)] outline-none"
              >
                <p className="t-body-sm text-fg-soft">
                  Выпуск за сегодня уже есть. Сделать ещё один? Это 3–6 минут и платные запросы.
                </p>
                <div className="mt-4 flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setConfirmOpen(false);
                      mainRef.current?.focus();
                    }}
                  >
                    Отмена
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => {
                      setConfirmOpen(false);
                      onGenerate();
                    }}
                  >
                    Сделать ещё один
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </header>
  );
}
