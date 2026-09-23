"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowDown,
  Check,
  CircleDashed,
  FileSearch,
  Globe,
  Loader2,
  Maximize2,
  Minimize2,
  TriangleAlert,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PipelineEvent } from "@/lib/schema";
import { STEPS, type StepDef } from "@/lib/steps";
import { cn, formatDuration, plural } from "@/lib/utils";
import { EASE, T } from "./motion";
import { Button } from "./ui/Button";
import { CopyButton } from "./ui/CopyButton";

export type StepState = { status: "idle" | "running" | "done" | "error"; detail?: string };
export type LogKind = Extract<PipelineEvent, { type: "log" }>["kind"];
export type LogItem = { id: number; kind: LogKind; text: string; at: number };

export interface PipelineState {
  status: "idle" | "running" | "done" | "error" | "cancelled";
  steps: Record<string, StepState>;
  logs: LogItem[];
  error?: string;
  startedAt?: number;
  finishedAt?: number;
}

/**
 * Пустое состояние под конкретный набор шагов. Список передаётся, потому что
 * панель обслуживает и выпуск, и ленту дня: у них разные шаги.
 */
export const emptyPipeline = (steps: StepDef[] = STEPS): PipelineState => ({
  status: "idle",
  steps: Object.fromEntries(steps.map((s) => [s.id, { status: "idle" as const }])),
  logs: [],
});

const LOG_KINDS: { kind: LogKind; label: string }[] = [
  { kind: "search", label: "Поиск" },
  { kind: "fetch", label: "Открыто" },
  { kind: "result", label: "Найдено" },
  { kind: "info", label: "Ход работы" },
  { kind: "warn", label: "Предупреждения" },
  { kind: "tech", label: "Техническое" },
];

const KIND_COLOR: Record<LogKind, string> = {
  search: "text-accent",
  fetch: "text-accent-2",
  result: "text-muted",
  info: "text-fg",
  warn: "text-warn",
  tech: "text-faint",
};

/*
 * Что показываем сразу. Технические строки выключены намеренно: их
 * больше, чем всех остальных вместе, и за перечнем открытых доменов и
 * времени разбора каждой пачки переставало быть видно, что вообще
 * происходит. Они никуда не делись — одно нажатие, и они здесь.
 */
const ALL_VISIBLE: Record<LogKind, boolean> = {
  search: true,
  fetch: true,
  result: true,
  info: true,
  warn: true,
  tech: false,
};

function clock(at: number) {
  return new Date(at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function titleFor(state: PipelineState, preview?: boolean) {
  if (preview) return "Как работает генерация";
  switch (state.status) {
    case "running":
      return "Собираю выпуск";
    case "done":
      return "Выпуск готов";
    case "error":
      return "Остановлено с ошибкой";
    case "cancelled":
      return "Прогон остановлен";
    default:
      return "Конвейер";
  }
}

function StepIcon({ status }: { status: StepState["status"] }) {
  const reduce = useReducedMotion();
  if (status === "running") return <Loader2 size={15} className="animate-spin text-accent" aria-hidden />;
  if (status === "done")
    return (
      <motion.span
        initial={reduce ? false : { scale: 0.4, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 500, damping: 25 }}
        className="inline-flex"
      >
        <Check size={15} className="text-ok" strokeWidth={3} aria-hidden />
      </motion.span>
    );
  if (status === "error") return <X size={15} className="text-bad" strokeWidth={3} aria-hidden />;
  return <CircleDashed size={15} className="text-faint" aria-hidden />;
}

/** Живой счётчик прогона: тикает раз в секунду, пока идёт работа. */
function useElapsed(state: PipelineState) {
  const running = state.status === "running";
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [running]);
  const end = state.finishedAt ?? now;
  return state.startedAt && end ? Math.max(0, end - state.startedAt) : 0;
}

/**
 * Свёрнутая полоса конвейера: после «Скрыть» прогон не пропадает бесследно —
 * строка остаётся кликабельной и возвращает панель.
 */
export function PipelineSummaryBar({ state, onOpen }: { state: PipelineState; onOpen: () => void }) {
  const elapsed = useElapsed(state);
  const running = state.status === "running";
  const counts = useMemo(() => {
    let searches = 0;
    let fetches = 0;
    let warns = 0;
    for (const l of state.logs) {
      if (l.kind === "search") searches += 1;
      if (l.kind === "fetch") fetches += 1;
      if (l.kind === "warn") warns += 1;
    }
    return { searches, fetches, warns };
  }, [state.logs]);

  if (state.status === "idle" && state.logs.length === 0) return null;

  const head = running
    ? "Собираю выпуск"
    : state.status === "cancelled"
      ? "Прогон остановлен"
      : state.status === "error"
        ? "Прогон с ошибкой"
        : "Последний прогон";

  const parts = [
    elapsed > 0 ? formatDuration(elapsed) : null,
    `${counts.searches} ${plural(counts.searches, "поиск", "поиска", "поисков")}`,
    `${counts.fetches} ${plural(counts.fetches, "страница", "страницы", "страниц")}`,
    counts.warns > 0
      ? `${counts.warns} ${plural(counts.warns, "предупреждение", "предупреждения", "предупреждений")}`
      : null,
  ].filter((p): p is string => Boolean(p));

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex w-full flex-col gap-1.5 border-t border-line py-2.5 text-left transition-colors duration-150 hover:border-line-strong hover:bg-surface-2"
    >
      <span
        className={cn("block h-0.5 w-full", running ? "rule-running" : "bg-line")}
        aria-busy={running ? "true" : undefined}
        aria-hidden={running ? undefined : true}
      />
      {/* Боковые поля — на тексте, а не на кнопке: линейка прогресса выше остаётся во всю ширину. */}
      <span className="t-meta flex flex-wrap items-baseline gap-x-2 px-4 uppercase md:px-8 xl:px-12">
        <span className={cn(state.status === "error" ? "text-bad" : "text-muted")}>{head}:</span>
        <span className="text-fg">{parts.join(" · ")}</span>
      </span>
      <span className="t-micro px-4 group-hover:text-muted md:px-8 xl:px-12">Развернуть панель конвейера</span>
    </button>
  );
}

export function PipelinePanel({
  state,
  onClose,
  preview,
  steps = STEPS,
  kicker = "Конвейер",
}: {
  state: PipelineState;
  onClose: () => void;
  preview?: boolean;
  /** Шаги показываемого конвейера. По умолчанию — шаги выпуска. */
  steps?: StepDef[];
  /** Что за конвейер идёт: «Конвейер» для выпуска, «Лента дня» для раздела «Сегодня». */
  kicker?: string;
}) {
  const logRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const prevCountRef = useRef(0);
  /** Пока идёт наша плавная прокрутка — метка её окончания; события скролла до неё не считаем жестом пользователя. */
  const smoothUntilRef = useRef(0);
  const smoothTimerRef = useRef(0);
  const reduce = useReducedMotion();
  const running = state.status === "running";
  const elapsed = useElapsed(state);

  const [visible, setVisible] = useState<Record<LogKind, boolean>>(ALL_VISIBLE);
  const [expanded, setExpanded] = useState(false);
  const [unseen, setUnseen] = useState(0);

  const counts = useMemo(() => {
    const acc: Record<LogKind, number> = { search: 0, fetch: 0, result: 0, info: 0, warn: 0, tech: 0 };
    for (const l of state.logs) acc[l.kind] += 1;
    return acc;
  }, [state.logs]);

  const shown = useMemo(() => state.logs.filter((l) => visible[l.kind]), [state.logs, visible]);
  const logText = useMemo(() => state.logs.map((l) => `${clock(l.at)}  ${l.text}`).join("\n"), [state.logs]);

  const stickToBottom = useCallback(() => {
    const el = logRef.current;
    if (!el) return;
    atBottomRef.current = true;
    setUnseen(0);
    if (reduce) {
      el.scrollTop = el.scrollHeight;
      return;
    }
    // Плавная прокрутка едет на старый scrollHeight, и её промежуточные onScroll
    // сбрасывали бы прилипание. Пока анимация в пути — отметки скролла игнорируем,
    // а по её окончании дотягиваем до низа (за время анимации лог мог подрасти).
    smoothUntilRef.current = Date.now() + 700;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    window.clearTimeout(smoothTimerRef.current);
    smoothTimerRef.current = window.setTimeout(() => {
      smoothUntilRef.current = 0;
      const end = logRef.current;
      if (end && atBottomRef.current) end.scrollTop = end.scrollHeight;
    }, 700);
  }, [reduce]);

  useEffect(() => () => window.clearTimeout(smoothTimerRef.current), []);

  const onLogScroll = useCallback(() => {
    const el = logRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    if (Date.now() < smoothUntilRef.current) {
      // Анимация доехала до низа — дальше события скролла снова принадлежат пользователю.
      if (atBottom) smoothUntilRef.current = 0;
      return;
    }
    atBottomRef.current = atBottom;
    if (atBottom) setUnseen(0);
  }, []);

  // Прилипание к низу: если читают середину лога, скролл не дёргаем, а считаем новые строки.
  useEffect(() => {
    const el = logRef.current;
    const added = shown.length - prevCountRef.current;
    prevCountRef.current = shown.length;
    // Строк стало меньше — лог сбросили новым прогоном или скрыли фильтром:
    // счётчик от прошлого списка показывать нечестно.
    if (added < 0) setUnseen(0);
    if (!el || added <= 0) return;
    if (atBottomRef.current) {
      el.scrollTop = el.scrollHeight;
      setUnseen(0);
    } else {
      setUnseen((n) => n + added);
    }
  }, [shown.length]);

  const progress = useMemo(() => {
    let done = 0;
    for (const step of steps) {
      const s = state.steps[step.id];
      if (!s) continue;
      if (s.status === "done") done += step.weight;
      else if (s.status === "running") done += step.weight / 2;
    }
    return Math.min(1, done);
  }, [state.steps, steps]);

  return (
    <motion.section
      className="panel overflow-hidden pt-0"
      initial={reduce ? false : { opacity: 0, y: -8, height: 0 }}
      animate={{ opacity: 1, y: 0, height: "auto" }}
      exit={reduce ? undefined : { opacity: 0, y: -8, height: 0 }}
      transition={{ duration: T.big, ease: EASE }}
      aria-live="polite"
      aria-busy={running ? "true" : undefined}
    >
      {/* Две линейки сверху: бегущая — что процесс жив, сплошная — доля пройденных шагов. */}
      <div className="h-0.5 w-full" aria-hidden={running ? undefined : true}>
        {running && <div className="rule-running h-full w-full" aria-busy="true" />}
      </div>
      <div className="h-0.5 w-full bg-line" aria-hidden>
        <div
          className="h-full bg-accent transition-[width] duration-300"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>

      <div className="flex flex-col gap-5 px-4 pt-5 md:px-8 xl:px-12">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="t-label mb-2">{kicker}</div>
            <h2 className="t-d2">{titleFor(state, preview)}</h2>
            <p className="t-body-sm mt-2 max-w-[62ch] text-muted">
              {preview
                ? "В превью генерация выключена: конвейер ходит в интернет через API и запускается только в локальной версии. Ниже — что происходит на каждом шаге."
                : "Поиск и открытие первоисточников — через Tavily, тексты пишет Gemini. Обычно это 3–6 минут."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {elapsed > 0 && <span className="t-meta text-muted">{formatDuration(elapsed)}</span>}
            {/* «Остановить» живёт только в шапке: она видна всегда, а панель можно свернуть. */}
            {!running && (
              <Button size="sm" variant="ghost" onClick={onClose} aria-label="Скрыть панель">
                <X size={14} aria-hidden />
                Скрыть
              </Button>
            )}
          </div>
        </div>

        {/* Число колонок на широком экране равно числу шагов: панель обслуживает
            конвейеры разной длины, и зашитая пятёрка ломала бы любой другой. */}
        <ol
          className={cn(
            "grid grid-cols-1 gap-2 @min-[520px]:grid-cols-2",
            "@min-[960px]:[grid-template-columns:repeat(var(--steps),minmax(0,1fr))]",
          )}
          style={{ ["--steps" as string]: String(steps.length) }}
        >
          {steps.map((step, i) => {
            const s = state.steps[step.id] ?? { status: "idle" as const };
            const active = s.status === "running";
            return (
              <li
                key={step.id}
                className={cn(
                  "card relative flex flex-col gap-1.5 border-l-2 px-3.5 py-3 transition-colors duration-150",
                  active ? "border-l-accent bg-accent-soft" : "border-l-transparent",
                  s.status === "done" && "border-l-ok",
                  s.status === "error" && "border-l-bad",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={cn("tabular font-mono text-[10px]", s.status === "done" ? "text-ok" : "text-faint")}>
                    0{i + 1}
                  </span>
                  <StepIcon status={s.status} />
                </div>
                <div className="text-[11.5px] font-semibold">{step.title}</div>
                <div className="t-caption leading-snug">{s.detail ?? step.hint}</div>
              </li>
            );
          })}
        </ol>

        {preview ? (
          <div className="t-body-sm grid grid-cols-1 gap-3 text-muted @min-[680px]:grid-cols-2">
            <div className="panel-2 flex gap-3 p-4">
              <Globe size={18} className="mt-0.5 shrink-0 text-accent" aria-hidden />
              <p>
                <b className="text-fg">Ресерч.</b> Модель делает до 20 поисков по спискам источников из брифа: мир,
                Казахстан, СНГ, экспертная линза, наука. Каждый запрос виден в логе.
              </p>
            </div>
            <div className="panel-2 flex gap-3 p-4">
              <FileSearch size={18} className="mt-0.5 shrink-0 text-accent" aria-hidden />
              <p>
                <b className="text-fg">Проверка.</b> Второй проход открывает первоисточники, отбрасывает
                неподтверждённое и проставляет уверенность: высокая или средняя.
              </p>
            </div>
            <div className="panel-2 p-4 @min-[680px]:col-span-2">
              <p>
                Дальше — тема дня и три формата строго из проверенных фактов, проверка структуры по схеме (Zod) и
                сохранение в <span className="font-mono text-[11px]">data/editions/ГГГГ-ММ-ДД.json</span>. Чтобы
                запустить: скачайте проект, <span className="font-mono text-[11px]">npm install</span>, ключ в{" "}
                <span className="font-mono text-[11px]">.env.local</span>,{" "}
                <span className="font-mono text-[11px]">npm run dev</span>.
              </p>
            </div>
          </div>
        ) : (
          <>
            <AnimatePresence>
              {state.error && (
                <motion.div
                  initial={reduce ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduce ? undefined : { opacity: 0 }}
                  className="t-body-sm flex items-start gap-2.5 border-l-2 border-bad bg-bad-soft px-4 py-3"
                  role="alert"
                >
                  <TriangleAlert size={16} className="mt-0.5 shrink-0 text-bad" aria-hidden />
                  <span>{state.error}</span>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                {LOG_KINDS.map(({ kind, label }) => (
                  <button
                    key={kind}
                    type="button"
                    aria-pressed={visible[kind]}
                    onClick={() => setVisible((v) => ({ ...v, [kind]: !v[kind] }))}
                    className={cn(
                      // Палец не попадает в 28 пикселей: на тач-экранах чип тянется до 44.
                      "t-meta inline-flex h-7 items-center gap-1.5 rounded-[4px] border px-2.5 uppercase transition-colors duration-150",
                      "[@media(pointer:coarse)]:min-h-11",
                      visible[kind] ? "border-line-strong text-fg" : "border-line text-faint line-through",
                      kind === "warn" && counts.warn > 0 && visible[kind] && "border-warn text-warn",
                    )}
                  >
                    {label}
                    <span className="tabular">{counts[kind]}</span>
                  </button>
                ))}
                <div className="ml-auto flex items-center gap-2">
                  <CopyButton variant="ghost" size="sm" text={logText} label="Копировать лог" doneLabel="Лог скопирован" />
                  <Button size="sm" variant="ghost" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
                    {expanded ? <Minimize2 size={14} aria-hidden /> : <Maximize2 size={14} aria-hidden />}
                    {expanded ? "Свернуть" : "Развернуть"}
                  </Button>
                </div>
              </div>

              <div className="relative">
                <div
                  ref={logRef}
                  onScroll={onLogScroll}
                  tabIndex={0}
                  role="log"
                  aria-label="Лог прогона, прокручивается"
                  className="t-log thin-scroll overflow-y-auto rounded-[4px] border border-line bg-surface-2 p-3"
                  style={{ height: expanded ? "80vh" : "40vh" }}
                >
                  {state.logs.length === 0 && <div className="text-faint">Лог появится после старта…</div>}
                  {state.logs.length > 0 && shown.length === 0 && (
                    <div className="text-faint">Все строки скрыты фильтром — включите нужные типы.</div>
                  )}
                  {shown.map((l) => (
                    <div key={l.id} className="flex gap-2">
                      <span className="tabular w-[68px] shrink-0 text-faint">{clock(l.at)}</span>
                      <span className={cn("min-w-0 break-words", KIND_COLOR[l.kind])}>{linkify(l.text)}</span>
                    </div>
                  ))}
                </div>

                <AnimatePresence>
                  {unseen > 0 && (
                    <motion.button
                      type="button"
                      onClick={stickToBottom}
                      initial={reduce ? false : { opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={reduce ? undefined : { opacity: 0, y: 6 }}
                      transition={{ duration: T.base, ease: EASE }}
                      className="t-meta absolute bottom-3 left-1/2 inline-flex h-8 -translate-x-1/2 items-center gap-1.5 rounded-[4px] border border-line-strong bg-surface-3 px-3 text-fg shadow-panel [@media(pointer:coarse)]:min-h-11"
                    >
                      <ArrowDown size={13} aria-hidden />
                      Новых строк: <span className="tabular">{unseen}</span>
                    </motion.button>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </>
        )}
      </div>
    </motion.section>
  );
}

/** URL в строке лога — живая ссылка: из лога хочется сразу открыть первоисточник. */
function linkify(text: string) {
  const parts = text.split(/(https?:\/\/[^\s)]+)/g);
  return parts.map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a key={i} href={part} target="_blank" rel="noreferrer noopener" className="link">
        {part}
      </a>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}
