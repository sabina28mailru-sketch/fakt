"use client";

import { motion, useReducedMotion } from "framer-motion";
import { CalendarDays, Cpu, Link2, Timer } from "lucide-react";
import type { Edition, Level } from "@/lib/schema";
import { editionToText } from "@/lib/to-text";
import { LEVEL_LABEL, formatDateRu, formatDuration, plural } from "@/lib/utils";
import { EASE } from "./motion";
import { Mark } from "./ui/Badge";
import { CopyButton } from "./ui/CopyButton";

const LEVEL_DOT: Record<Level, string> = {
  world: "bg-lv-world",
  kz: "bg-lv-kz",
  cis: "bg-lv-cis",
  science: "bg-lv-science",
};

const LEVEL_ORDER: Level[] = ["world", "kz", "cis", "science"];

/** Ячейка паспорта достоверности: hairline-разделители рисуются снаружи, через className. */
function Cell({
  kicker,
  className,
  children,
}: {
  kicker: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`flex min-w-0 flex-col gap-3 py-5 pr-4 ${className ?? ""}`}>
      <span className="t-label">{kicker}</span>
      {children}
    </div>
  );
}

function ConfidenceMeter({ edition }: { edition: Edition }) {
  const facts = edition.facts.length;
  const total = facts || 1;
  const high = edition.facts.filter((f) => f.confidence === "high").length;
  const medium = edition.facts.filter((f) => f.confidence === "medium").length;
  const low = total - high - medium;
  const reduce = useReducedMotion();

  const seg = (n: number, cls: string, label: string) =>
    n > 0 && (
      <motion.div
        className={`h-full origin-left rounded-[2px] ${cls}`}
        style={{ flexBasis: `${(n / total) * 100}%` }}
        initial={reduce ? false : { scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ duration: 0.5, ease: EASE, delay: 0.15 }}
        title={label}
        aria-label={label}
      />
    );

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="t-stat text-fg">{facts}</span>
        <span className="t-meta text-muted">
          {plural(facts, "факт", "факта", "фактов")} · {high} выс · {medium} ср
          {low ? ` · ${low} низ` : ""}
        </span>
      </div>
      <div className="flex h-[3px] w-full gap-px overflow-hidden rounded-[2px] bg-surface-3">
        {seg(high, "bg-ok", `${high} с высокой уверенностью`)}
        {seg(medium, "bg-warn", `${medium} со средней уверенностью`)}
        {seg(low, "bg-bad", `${low} с низкой уверенностью`)}
      </div>
    </div>
  );
}

export function EditionHeader({
  edition,
  isToday,
}: {
  edition: Edition;
  isToday: boolean;
}) {
  const reduce = useReducedMotion();
  const counts: Record<Level, number> = {
    world: edition.facts.filter((f) => f.level === "world").length,
    kz: edition.facts.filter((f) => f.level === "kz").length,
    cis: edition.facts.filter((f) => f.level === "cis").length,
    science: edition.facts.filter((f) => f.level === "science").length,
  };

  return (
    <motion.header
      className="relative"
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: EASE }}
    >
      <div className="rule-bg pointer-events-none absolute inset-0" aria-hidden />

      <div className="relative flex flex-col gap-6">
        {isToday ? (
          <div className="flex h-8 items-center">
            <Mark tone="ok">Сегодняшний выпуск</Mark>
          </div>
        ) : (
          <div
            role="status"
            className="flex flex-col gap-3 border-l-2 border-warn bg-warn-soft px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
          >
            {/* Только предупреждение: кнопка генерации одна, и она в шапке. */}
            <p className="t-body-sm text-fg">
              Это выпуск за {formatDateRu(edition.date)}. Сегодняшнего ещё нет — соберите его кнопкой в шапке.
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {/* Рубрика бывает длиной в строку, поэтому это кикер с переносом, а не пилюля nowrap. */}
          <span className="t-label min-w-0 leading-[1.5] break-words text-accent">
            {edition.weekday} · {edition.rubric}
          </span>
          <span className="t-stat inline-flex items-center gap-2 text-fg">
            <CalendarDays size={15} className="text-muted" aria-hidden />
            {formatDateRu(edition.date)}
          </span>
          {edition.meta.generatedBy === "manual" && <Mark tone="warn">Ручной прогон по брифу</Mark>}
        </div>

        <div className="flex flex-col gap-3">
          <div className="t-label">Тема дня</div>
          <h1 className="t-d1 max-w-[22ch]">{edition.topic.title}</h1>
          <p className="t-lead">{edition.topic.whyNow}</p>
        </div>

        <div className="grid grid-cols-2 border-y border-line @min-[860px]:grid-cols-4">
          <Cell kicker="Уверенность в фактах">
            <ConfidenceMeter edition={edition} />
          </Cell>

          <Cell kicker="Уровни" className="border-l border-line pl-4">
            <ul className="flex flex-col gap-1.5">
              {LEVEL_ORDER.map((level) => (
                <li key={level} className="t-meta flex items-center gap-2 text-fg uppercase">
                  <span className={`size-[7px] shrink-0 rounded-full ${LEVEL_DOT[level]}`} aria-hidden />
                  <span className="truncate">{LEVEL_LABEL[level]}</span>
                  <span className="ml-auto tabular">{counts[level]}</span>
                </li>
              ))}
            </ul>
          </Cell>

          <Cell kicker="Прогон" className="border-t border-line @min-[860px]:border-t-0 @min-[860px]:border-l @min-[860px]:pl-4">
            <div className="t-meta flex flex-col gap-1.5 text-muted">
              <span className="inline-flex items-center gap-1.5">
                <Cpu size={13} aria-hidden />
                <span className="truncate">{edition.meta.model}</span>
              </span>
              {edition.meta.durationMs ? (
                <span className="inline-flex items-center gap-1.5">
                  <Timer size={13} aria-hidden />
                  {formatDuration(edition.meta.durationMs)}
                </span>
              ) : null}
              {typeof edition.meta.searches === "number" ? (
                <span className="inline-flex items-center gap-1.5">
                  <Link2 size={13} aria-hidden />
                  {edition.meta.searches} поисков
                  {edition.meta.fetches ? ` · ${edition.meta.fetches} страниц` : ""}
                </span>
              ) : null}
            </div>
          </Cell>

          <Cell
            kicker="Выпуск целиком"
            className="border-t border-l border-line pl-4 @min-[860px]:border-t-0"
          >
            <CopyButton
              text={editionToText(edition)}
              label="Копировать весь выпуск"
              variant="secondary"
              size="md"
              // в ячейке 2×2 на узком экране подпись переносится, а не режется
              className="h-auto min-h-10 w-full py-2 text-center whitespace-normal"
            />
          </Cell>
        </div>
      </div>
    </motion.header>
  );
}
