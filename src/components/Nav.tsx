"use client";

import { motion, useReducedMotion } from "framer-motion";
import { History, Newspaper, SlidersHorizontal, Sparkles, Telescope } from "lucide-react";
import { cn, plural } from "@/lib/utils";
import { SPRING } from "./motion";

export type View = "today" | "edition" | "research" | "history" | "brief";

const ITEMS: { id: View; label: string; Icon: typeof Newspaper }[] = [
  // «Сегодня» первым: это главный экран, с него начинается день.
  { id: "today", label: "Сегодня", Icon: Sparkles },
  { id: "edition", label: "Выпуск", Icon: Newspaper },
  { id: "research", label: "Темы", Icon: Telescope },
  { id: "history", label: "История", Icon: History },
  { id: "brief", label: "Бриф", Icon: SlidersHorizontal },
];

/** Сводка достоверности текущего выпуска для блока «Статус проверки» в рельсе. */
export interface NavStatus {
  /** Дата выпуска коротко: «18.09» */
  date: string;
  total: number;
  high: number;
  medium: number;
  low: number;
}

export function Wordmark() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-accent text-accent-fg">
        <span className="font-display text-[13px] leading-none font-semibold">F</span>
      </span>
      <span className="flex min-w-0 flex-col leading-none">
        <span className="font-display text-[14px] leading-none font-semibold tracking-tight uppercase">Fakt</span>
        <span className="t-label mt-1.5">Проверенный контент</span>
      </span>
    </div>
  );
}

/** Сегментированная 3px-линейка уверенности: цвет дублируется цифрами строкой выше. */
function ConfidenceRule({ status }: { status: NavStatus }) {
  const segments: { key: string; value: number; className: string; label: string }[] = [
    { key: "high", value: status.high, className: "bg-ok", label: "с высокой уверенностью" },
    { key: "medium", value: status.medium, className: "bg-warn", label: "со средней уверенностью" },
    { key: "low", value: status.low, className: "bg-bad", label: "с низкой уверенностью" },
  ];
  const visible = segments.filter((s) => s.value > 0);
  if (!visible.length) return null;
  return (
    <div
      className="mt-3 flex h-[3px] w-full gap-px bg-line"
      role="img"
      aria-label={visible.map((s) => `${s.value} ${s.label}`).join(", ")}
    >
      {visible.map((s) => (
        <span
          key={s.key}
          className={s.className}
          style={{ flexGrow: s.value, flexBasis: 0 }}
          title={`${s.value} ${s.label}`}
        />
      ))}
    </div>
  );
}

export function Nav({
  view,
  onChange,
  briefDirty = false,
  status,
}: {
  view: View;
  onChange: (v: View) => void;
  /** В брифе есть несохранённые правки — у пункта «Бриф» загорается точка. */
  briefDirty?: boolean;
  status?: NavStatus;
  /** Короткая сводка последнего прогона: «4 мин 12 с · 20 поисков». */
}) {
  const reduce = useReducedMotion();
  const spring = reduce ? { duration: 0 } : SPRING;

  return (
    <>
      {/* Левый рельс на десктопе */}
      <aside
        className="sticky top-0 hidden h-screen shrink-0 flex-col overflow-y-auto border-r border-line bg-bg px-5 py-6 lg:flex"
        style={{ width: "var(--rail)" }}
      >
        <Wordmark />

        <nav className="mt-8 flex flex-col" aria-label="Разделы">
          {ITEMS.map(({ id, label, Icon }, i) => {
            const active = id === view;
            const dirty = id === "brief" && briefDirty;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onChange(id)}
                aria-current={active ? "page" : undefined}
                aria-label={dirty ? `${label}, есть несохранённые правки` : undefined}
                title={`${label} · клавиша ${i + 1}`}
                className={cn(
                  "relative flex h-10 items-center gap-3 pr-2 pl-3.5 text-left text-[12px] font-bold transition-colors duration-[var(--t-base)]",
                  active ? "text-fg" : "text-muted hover:text-fg",
                )}
              >
                {active && (
                  <motion.span
                    layoutId="nav-rule"
                    className="absolute top-1 bottom-1 left-0 w-0.5 bg-accent"
                    initial={false}
                    transition={spring}
                  />
                )}
                <Icon size={16} className="shrink-0" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{label}</span>
                {dirty && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />}
              </button>
            );
          })}
        </nav>

        {status && (
          <div className="rule mt-8 pt-5">
            <span className="t-label">Статус проверки</span>
            <p className="t-meta mt-3 text-fg uppercase">Выпуск за {status.date}</p>
            <p className="t-meta mt-1 text-muted uppercase">
              {status.total} {plural(status.total, "факт", "факта", "фактов")} · {status.high} высокая
            </p>
            <ConfidenceRule status={status} />
          </div>
        )}

        <div className="mt-auto pt-8">
          <p className="t-body-sm text-muted">
            Ресерч, проверка источников и три формата — каждое утро.
          </p>
        </div>
      </aside>

      {/* Нижний док на мобильных */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/95 backdrop-blur lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        aria-label="Разделы"
      >
        <div className="flex" style={{ height: "var(--dock-h)" }}>
          {ITEMS.map(({ id, label, Icon }) => {
            const active = id === view;
            const dirty = id === "brief" && briefDirty;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onChange(id)}
                aria-current={active ? "page" : undefined}
                aria-label={dirty ? `${label}, есть несохранённые правки` : undefined}
                className={cn(
                  "relative flex flex-1 flex-col items-center justify-center gap-1 transition-colors duration-[var(--t-base)]",
                  active ? "text-fg" : "text-muted",
                )}
              >
                {active && (
                  <motion.span
                    layoutId="nav-rule-m"
                    className="absolute inset-x-0 top-0 h-0.5 bg-accent"
                    initial={false}
                    transition={spring}
                  />
                )}
                <span className="relative">
                  <Icon size={18} aria-hidden />
                  {dirty && (
                    <span className="absolute -top-0.5 -right-1.5 h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
                  )}
                </span>
                <span className="font-mono text-[10px] leading-none font-medium tracking-[0.08em] uppercase">
                  {label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}
