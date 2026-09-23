"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ChevronDown,
  ExternalLink,
  Loader2,
  Plus,
  Search,
  Sparkles,
  Square,
  TriangleAlert,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Credibility,
  Edition,
  PipelineEvent,
  ResearchAnswer,
  ResearchEvent,
  ResearchMaterial,
  ResearchResult,
  ResearchStepId,
} from "@/lib/schema";
import { cn, formatDateRu, hostOf, plural } from "@/lib/utils";
import { EASE, T, fadeUpAt } from "./motion";
import { Mark } from "./ui/Badge";
import { Button } from "./ui/Button";
import { CopyButton } from "./ui/CopyButton";
import { Section } from "./ui/Section";
import { useToast } from "./ui/Toast";

const STEPS: { id: ResearchStepId; title: string; hint: string }[] = [
  { id: "intent", title: "Намерение", hint: "Что именно вы ищете" },
  { id: "search", title: "Поиск", hint: "От свежего к более старому" },
  { id: "open", title: "Открытие", hint: "Страницы целиком, не сниппеты" },
  { id: "judge", title: "Соответствие", hint: "Подтверждение связи с темой" },
  { id: "answer", title: "Ответ", hint: "Сводка по теме и оценка" },
];

type StepStatus = "idle" | "running" | "done" | "error";
type Steps = Record<ResearchStepId, { status: StepStatus; detail?: string }>;

const emptySteps = (): Steps => ({
  intent: { status: "idle" },
  search: { status: "idle" },
  open: { status: "idle" },
  judge: { status: "idle" },
  answer: { status: "idle" },
});

interface LogLine {
  id: number;
  kind: "search" | "fetch" | "result" | "info" | "warn";
  text: string;
}

const KIND_COLOR: Record<LogLine["kind"], string> = {
  search: "text-accent",
  fetch: "text-accent-2",
  result: "text-muted",
  info: "text-fg",
  warn: "text-warn",
};

const FRESHNESS_LABEL: Record<ResearchMaterial["freshness"], string> = {
  days: "Последние дни",
  weeks: "Последние недели",
  months: "Последние месяцы",
  older: "Старше трёх месяцев",
  unknown: "Дата неизвестна",
};

const SOURCE_KIND_LABEL: Record<string, string> = {
  primary: "Первоисточник",
  research: "Исследование",
  official: "Официальный документ",
  publication: "Публикация",
};

export function ResearchView({
  initialTags,
  initialResult,
  preview,
  onContentReady,
}: {
  initialTags: string[];
  initialResult?: ResearchResult;
  preview: boolean;
  /** Готовый выпуск по теме: App добавит его в список и откроет раздел «Выпуск». */
  onContentReady?: (edition: Edition) => void;
}) {
  const [topic, setTopic] = useState(initialResult?.topic ?? "");
  const [tags, setTags] = useState<string[]>(initialTags);
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<Steps>(emptySteps);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [result, setResult] = useState<ResearchResult | undefined>(initialResult);
  const [error, setError] = useState("");
  const [showRejected, setShowRejected] = useState(false);
  const [writing, setWriting] = useState(false);
  const [writeStep, setWriteStep] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const reduce = useReducedMotion();

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs.length]);

  const saveTags = useCallback(
    async (next: string[]) => {
      setTags(next);
      try {
        const res = await fetch("/api/research/tags", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tags: next }),
        });
        if (!res.ok) throw new Error(`Сервер ответил ${res.status}`);
        const body = (await res.json()) as { tags: string[] };
        setTags(body.tags);
      } catch (e) {
        toast(e instanceof Error ? e.message : "Не удалось сохранить тему", "warn");
      }
    },
    [toast],
  );

  const research = useCallback(
    async (query: string) => {
      const clean = query.trim();
      if (!clean || running) return;
      if (preview) {
        toast("В превью исследование выключено: оно ходит в интернет", "warn");
        return;
      }
      setRunning(true);
      setSteps(emptySteps());
      setLogs([]);
      setError("");
      setShowRejected(false);

      const controller = new AbortController();
      abortRef.current = controller;
      let counter = 0;

      try {
        const res = await fetch("/api/research", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ topic: clean }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) throw new Error(`Сервер ответил ${res.status}`);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const chunks = buffer.split("\n\n");
          buffer = chunks.pop() ?? "";
          for (const chunk of chunks) {
            const line = chunk.split("\n").find((l) => l.startsWith("data: "));
            if (!line) continue;
            const event = JSON.parse(line.slice(6)) as ResearchEvent;
            if (event.type === "step") {
              setSteps((s) => ({ ...s, [event.step]: { status: event.status, detail: event.detail } }));
            } else if (event.type === "log") {
              counter += 1;
              const id = counter;
              setLogs((l) => [...l, { id, kind: event.kind, text: event.text }]);
            } else if (event.type === "error") {
              setError(event.message);
              setSteps((s) => {
                const next = { ...s };
                for (const k of Object.keys(next) as ResearchStepId[]) {
                  if (next[k].status === "running") next[k] = { status: "error" };
                }
                return next;
              });
            } else if (event.type === "done") {
              setResult(event.result);
              toast(`Готово: ${event.result.materials.length} ${plural(event.result.materials.length, "материал", "материала", "материалов")}`);
            }
          }
        }
      } catch (e) {
        if (!(e instanceof DOMException && e.name === "AbortError")) {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        controller.abort();
        if (abortRef.current === controller) abortRef.current = null;
        setRunning(false);
      }
    },
    [preview, running, toast],
  );

  /** Три формата по уже исследованной теме: поиск заново не гоняем. */
  const writeContent = useCallback(async () => {
    if (!result || writing || running) return;
    if (preview) {
      toast("В превью генерация выключена", "warn");
      return;
    }
    setWriting(true);
    setWriteStep("Готовлю материалы…");
    try {
      const res = await fetch("/api/research/content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: result.topic }),
      });
      if (!res.ok || !res.body) throw new Error(`Сервер ответил ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";
        for (const chunk of chunks) {
          const line = chunk.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          const event = JSON.parse(line.slice(6)) as PipelineEvent;
          if (event.type === "step" && event.status === "running") {
            setWriteStep(event.step === "write" ? "Пишу три формата…" : "Проверяю структуру…");
          } else if (event.type === "error") {
            toast(event.message, "warn");
            setError(event.message);
          } else if (event.type === "done") {
            toast("Контент по теме готов");
            onContentReady?.(event.edition);
          }
        }
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "warn");
    } finally {
      setWriting(false);
      setWriteStep("");
    }
  }, [onContentReady, preview, result, running, toast, writing]);

  const core = result?.materials.filter((m) => m.relation === "core") ?? [];
  const related = result?.materials.filter((m) => m.relation === "related") ?? [];
  const tagged = tags.some((t) => t.toLowerCase() === topic.trim().toLowerCase());

  return (
    <div className="flex flex-col gap-10">
      <Section
        eyebrow="Исследовать тему"
        title="Поиск по вашей теме"
        description="Свежие материалы строго по вашей теме, с открытыми первоисточниками."
      >
        <form
          className="flex flex-col gap-3 @min-[640px]:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            void research(topic);
          }}
        >
          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="sr-only">Тема исследования</span>
            <div className="flex min-w-0 items-center gap-2 rounded-lg border border-line bg-surface-2 px-3.5 focus-within:border-line-strong">
              <Search size={16} className="shrink-0 text-muted" aria-hidden />
              <input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                disabled={running}
                placeholder="AI в стоматологии, личный бренд врача, детские коляски…"
                className="h-11 min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-faint disabled:opacity-60"
              />
            </div>
          </label>
          <div className="flex shrink-0 gap-2">
            <Button type="submit" variant="primary" size="md" disabled={running || !topic.trim()}>
              {running ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Search size={16} aria-hidden />}
              {running ? "Ищу…" : "Исследовать"}
            </Button>
            {running && (
              <Button variant="ghost" size="md" onClick={() => abortRef.current?.abort()}>
                <Square size={14} aria-hidden />
                Остановить
              </Button>
            )}
            {!running && topic.trim() && !tagged && (
              <Button
                variant="secondary"
                size="md"
                onClick={() => void saveTags([...tags, topic.trim()])}
                title="Сохранить тему"
              >
                <Plus size={15} aria-hidden />
                <span className="hidden @min-[840px]:inline">Сохранить тему</span>
              </Button>
            )}
          </div>
        </form>

        {tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="t-kicker">Сохранённые темы</span>
            {tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center overflow-hidden rounded-full border border-line bg-surface-2 backdrop-blur-sm"
              >
                <button
                  type="button"
                  onClick={() => {
                    setTopic(tag);
                    void research(tag);
                  }}
                  disabled={running}
                  className="h-8 px-3 font-mono text-[10px] font-bold tracking-[0.06em] text-fg transition-colors hover:bg-surface-3 disabled:opacity-50 [@media(pointer:coarse)]:h-11"
                >
                  #{tag}
                </button>
                <button
                  type="button"
                  onClick={() => void saveTags(tags.filter((t) => t !== tag))}
                  aria-label={`Убрать тему ${tag}`}
                  className="flex h-8 w-7 items-center justify-center text-faint transition-colors hover:text-bad [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
                >
                  <X size={12} aria-hidden />
                </button>
              </span>
            ))}
          </div>
        )}
      </Section>

      <AnimatePresence initial={false}>
        {(running || logs.length > 0 || error) && (
          <motion.section
            initial={reduce ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={reduce ? undefined : { opacity: 0, height: 0 }}
            transition={{ duration: T.big, ease: EASE }}
            className="overflow-hidden"
            aria-live="polite"
          >
            <div className="flex flex-col gap-4">
              <span className={cn("block h-0.5 w-full", running ? "rule-running" : "bg-line")} aria-busy={running} />

              <ol className="grid grid-cols-1 gap-2 @min-[520px]:grid-cols-2 @min-[960px]:grid-cols-5">
                {STEPS.map((step, i) => {
                  const s = steps[step.id];
                  return (
                    <li
                      key={step.id}
                      className={cn(
                        "card flex flex-col gap-1 px-3.5 py-3",
                        s.status === "running" && "border-accent",
                        s.status === "done" && "border-ok/50",
                        s.status === "error" && "border-bad/60",
                      )}
                    >
                      <span className="t-micro">{String(i + 1).padStart(2, "0")}</span>
                      <span className="text-[11.5px] font-semibold">{step.title}</span>
                      <span className="t-caption">{s.detail ?? step.hint}</span>
                    </li>
                  );
                })}
              </ol>

              {error && (
                <div className="mark flex items-start gap-2.5 border-bad bg-bad-soft px-4 py-3 text-bad" role="alert">
                  <TriangleAlert size={16} className="mt-0.5 shrink-0" aria-hidden />
                  <span className="t-body-sm text-fg">{error}</span>
                </div>
              )}

              {logs.length > 0 && (
                <div
                  ref={logRef}
                  className="thin-scroll panel-2 max-h-64 overflow-y-auto p-3"
                  role="log"
                  aria-label="Ход исследования"
                >
                  {logs.map((l) => (
                    <div key={l.id} className={cn("t-log", KIND_COLOR[l.kind])}>
                      {l.text}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      {result && (
        <div className="flex flex-col gap-10">
          <IntentBlock result={result} />

          {result.shortfall && (
            <div className="mark flex items-start gap-2.5 border-warn bg-warn-soft px-4 py-3 text-warn" role="status">
              <TriangleAlert size={16} className="mt-0.5 shrink-0" aria-hidden />
              <span className="t-body-sm text-fg">{result.shortfall}</span>
            </div>
          )}

          {(result.answer.summary || result.answer.points.length > 0) && (
            <AnswerBlock
              answer={result.answer}
              materials={result.materials}
              onWrite={() => void writeContent()}
              writing={writing}
              writeStep={writeStep}
              disabled={preview || running}
            />
          )}

          {core.length > 0 && (
            <Section
              eyebrow="По вашей теме"
              title={`${core.length} ${plural(core.length, "материал", "материала", "материалов")}`}
              description="Каждый подтверждён цитатой из источника."
            >
              <div className="flex flex-col gap-6">
                {core.map((m, i) => (
                  <MaterialCard key={m.id} material={m} index={i} />
                ))}
              </div>
            </Section>
          )}

          {related.length > 0 && (
            <Section
              eyebrow="Связанные материалы"
              title={`${related.length} ${plural(related.length, "материал", "материала", "материалов")} рядом с темой`}
              description="Рядом с темой, но не прямой ответ."
            >
              <div className="flex flex-col gap-6">
                {related.map((m, i) => (
                  <MaterialCard key={m.id} material={m} index={i} />
                ))}
              </div>
            </Section>
          )}

          {result.rejected.length > 0 && (
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={() => setShowRejected((v) => !v)}
                aria-expanded={showRejected}
                className="rule flex items-center gap-2 pt-4 text-left"
              >
                <ChevronDown
                  size={15}
                  className={cn("shrink-0 text-muted transition-transform", showRejected && "rotate-180")}
                  aria-hidden
                />
                <span className="t-kicker">
                  Отбраковано: {result.rejected.length}{" "}
                  {plural(result.rejected.length, "материал", "материала", "материалов")}
                </span>
              </button>
              {showRejected && (
                <ul className="flex flex-col gap-2">
                  {result.rejected.map((r) => (
                    <li key={r.url} className="panel-2 flex flex-col gap-1 p-3.5">
                      <a href={r.url} target="_blank" rel="noreferrer noopener" className="link t-body-sm">
                        {r.title || hostOf(r.url)}
                      </a>
                      <span className="t-caption">{r.reason}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {!result && !running && !error && (
        <div className="card flex flex-col items-center gap-3 p-12 text-center">
          <Search size={28} className="text-muted" aria-hidden />
          <h2 className="t-d3">Тема ещё не задана</h2>
          <p className="t-body-sm max-w-[52ch] text-muted">
            Например: «AI для стоматологических клиник» или «профилактика кариеса».
          </p>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   Раскрывающиеся блоки.

   Лента материалов перегружала экран: у каждого разом были видны
   пересказ, факты, цитата, разбор оценки и список источников.
   Теперь по умолчанию видно только то, по чему выбирают — заголовок,
   дату, источник и балл, — а подробности открываются по клику.
   ══════════════════════════════════════════════════════════════════ */

/** Заголовок-переключатель: строка, по которой кликают, чтобы раскрыть блок. */
function Toggle({
  open,
  onToggle,
  children,
  className,
  label,
}: {
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  className?: string;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={label}
      className={cn("group flex w-full items-center gap-2 text-left", className)}
    >
      <ChevronDown
        size={14}
        className={cn("shrink-0 text-muted transition-transform duration-150", open && "rotate-180")}
        aria-hidden
      />
      {children}
    </button>
  );
}

/** Содержимое раскрытого блока: при reduce-motion появляется без анимации высоты. */
function Panel({ open, children }: { open: boolean; children: React.ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          initial={reduce ? false : { height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={reduce ? undefined : { height: 0, opacity: 0 }}
          transition={{ duration: T.base, ease: EASE }}
          className="overflow-hidden"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Как система поняла запрос. Свёрнуто — одна строка. */
function IntentBlock({ result }: { result: ResearchResult }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="panel-2 flex flex-col gap-2 p-4">
      <Toggle open={open} onToggle={() => setOpen((v) => !v)} label="Как система поняла запрос">
        <span className="t-kicker shrink-0">Как я понял запрос</span>
        <span className="t-body-sm min-w-0 flex-1 truncate text-fg-soft group-hover:text-fg">
          {result.intent.restated}
        </span>
      </Toggle>
      <Panel open={open}>
        <div className="flex flex-col gap-2 pt-2 pl-6">
          <p className="t-body-sm text-fg">{result.intent.restated}</p>
          {result.intent.mustInclude.length > 0 && (
            <p className="t-body-sm text-muted">
              <span className="t-kicker">Обязательно вместе</span> {result.intent.mustInclude.join(" + ")}
            </p>
          )}
          {result.intent.notThis.length > 0 && (
            <p className="t-body-sm text-muted">
              <span className="t-kicker">Не подменял на</span> {result.intent.notThis.join("; ")}
            </p>
          )}
          <p className="t-micro">
            Запросов: {result.queries.length} · кредитов Tavily: {result.credits}
          </p>
          <ul className="flex flex-col gap-1">
            {result.queries.map((q, i) => (
              <li key={`${q}-${i}`} className="t-log text-muted">
                {q}
              </li>
            ))}
          </ul>
        </div>
      </Panel>
    </div>
  );
}

/**
 * Материал. Свёрнут — заголовок, дата, источник и балл: по ним выбирают,
 * что читать. Раскрыт — всё остальное.
 */
function MaterialCard({ material: m, index }: { material: ResearchMaterial; index: number }) {
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();
  const copyText = [
    m.title,
    m.date ? `Дата: ${formatDateRu(m.date)}` : "Дата не установлена",
    m.summary,
    m.facts.length ? `Факты:\n${m.facts.map((f) => `— ${f}`).join("\n")}` : "",
    `Источник: ${m.outlet} — ${m.url}`,
    m.sources.length ? `Подтверждения:\n${m.sources.map((s) => `— ${s.outlet}: ${s.url}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const tone = m.credibility.label === "высокая" ? "ok" : m.credibility.label === "средняя" ? "warn" : "bad";

  return (
    <motion.article
      className="card group flex flex-col"
      variants={reduce ? undefined : fadeUpAt(index)}
      initial={reduce ? false : "hidden"}
      animate="show"
    >
      <div className="flex items-start gap-3 p-4">
        <Toggle
          open={open}
          onToggle={() => setOpen((v) => !v)}
          label={`Подробности: ${m.title}`}
          className="min-w-0 flex-1 items-start"
        >
          <span className="flex min-w-0 flex-col gap-1.5">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="t-meta text-muted">{m.date ? formatDateRu(m.date) : "дата не установлена"}</span>
              <Mark tone={tone}>{m.credibility.score}/100</Mark>
              {m.relation === "related" && <Mark tone="warn">Связанный</Mark>}
            </span>
            <span className="t-d3 text-fg group-hover:underline">{m.title}</span>
            <span className="t-micro">{m.outlet}</span>
          </span>
        </Toggle>
        <div className="flex shrink-0 items-center gap-1">
          <a
            href={m.url}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={`Открыть источник: ${m.outlet}`}
            title="Открыть источник"
            className="inline-flex size-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-fg [@media(pointer:coarse)]:size-11"
          >
            <ExternalLink size={15} aria-hidden />
          </a>
          <CopyButton
            iconOnly
            variant="ghost"
            size="sm"
            text={copyText}
            label={`Копировать материал: ${m.title}`}
            className="w-8 px-0"
          />
        </div>
      </div>

      <Panel open={open}>
        <div className="flex flex-col gap-4 px-4 pb-4">
          <p className="t-content max-w-[70ch] text-fg-soft">{m.summary}</p>

          {m.whyNow && (
            <p className="t-body-sm max-w-[70ch]">
              <span className="t-kicker">Почему актуально</span> {m.whyNow}
            </p>
          )}

          {m.relation === "related" && m.relationNote && (
            <p className="t-body-sm max-w-[70ch] text-muted">
              <span className="t-kicker">Связь с темой</span> {m.relationNote}
            </p>
          )}

          {m.facts.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="t-kicker">Ключевые факты</span>
              <ul className="flex flex-col gap-1.5">
                {m.facts.map((f, i) => (
                  <li key={i} className="t-body-sm flex gap-2 text-fg">
                    <span className="mt-2 size-[4px] shrink-0 rounded-full bg-muted" aria-hidden />
                    <span className="min-w-0">{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {m.evidence && (
            <blockquote className="mark border-line">
              <span className="t-kicker">Цитата со страницы</span>
              <p className="t-body-sm mt-1 text-fg-soft">«{m.evidence}»</p>
            </blockquote>
          )}

          <CredibilityBlock credibility={m.credibility} confirmations={m.confirmations} freshness={m.freshness} />

          <div className="flex flex-col gap-2">
            <span className="t-kicker">Источники</span>
            <ul className="flex flex-col gap-1.5">
              <li className="flex flex-wrap items-baseline gap-x-2">
                <Mark tone="accent">Прямая ссылка</Mark>
                <a href={m.url} target="_blank" rel="noreferrer noopener" className="link t-body-sm min-w-0">
                  {m.outlet}
                </a>
              </li>
              {m.sources.map((s, i) => (
                <li key={`${s.url}-${i}`} className="flex flex-wrap items-baseline gap-x-2">
                  <Mark tone={s.kind === "publication" ? "neutral" : "ok"}>
                    {SOURCE_KIND_LABEL[s.kind] ?? "Источник"}
                  </Mark>
                  <a href={s.url} target="_blank" rel="noreferrer noopener" className="link t-body-sm min-w-0">
                    {s.outlet || hostOf(s.url)}
                    {s.date ? ` · ${s.date}` : ""}
                  </a>
                </li>
              ))}
            </ul>
            <p className="t-body-sm text-muted">
              {m.confirmations > 0
                ? `Подтверждено ${m.confirmations} ${plural(m.confirmations, "независимым источником", "независимыми источниками", "независимыми источниками")}.`
                : "Независимых подтверждений не найдено."}
            </p>
          </div>
        </div>
      </Panel>
    </motion.article>
  );
}

/** Разбор балла: сам балл виден всегда, из чего он сложился — по клику. */
function CredibilityBlock({
  credibility: c,
  confirmations,
  freshness,
}: {
  credibility: Credibility;
  confirmations: number;
  freshness: ResearchMaterial["freshness"];
}) {
  const [open, setOpen] = useState(false);
  const tone = c.label === "высокая" ? "ok" : c.label === "средняя" ? "warn" : "bad";
  const bar = c.label === "высокая" ? "bg-ok" : c.label === "средняя" ? "bg-warn" : "bg-bad";
  return (
    <div className="panel-2 flex flex-col gap-2 p-3">
      <Toggle open={open} onToggle={() => setOpen((v) => !v)} label="Из чего сложилась оценка достоверности">
        <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="t-kicker">Достоверность</span>
          <span className="t-stat text-fg">
            {c.score}
            <span className="text-muted">/100</span>
          </span>
          <Mark tone={tone}>{c.label}</Mark>
          <span className="t-body-sm text-muted">{FRESHNESS_LABEL[freshness]}</span>
          {confirmations > 0 && <span className="t-body-sm text-muted">· подтверждений: {confirmations}</span>}
        </span>
      </Toggle>

      <div className="h-[3px] w-full overflow-hidden rounded-[2px] bg-surface-3" aria-hidden>
        <div className={cn("h-full", bar)} style={{ width: `${c.score}%` }} />
      </div>

      <Panel open={open}>
        <ul className="flex flex-col gap-1 pt-2 pl-6">
          {c.reasons.map((r, i) => (
            <li
              key={i}
              className={cn("t-body-sm", r.startsWith("+") ? "text-ok" : r.startsWith("-") ? "text-bad" : "text-muted")}
            >
              {r}
            </li>
          ))}
          <li className="t-micro mt-1">Это оценка надёжности источников, а не гарантия истинности.</li>
        </ul>
      </Panel>
    </div>
  );
}

/**
 * Сводный ответ по теме. Сводка и пункты видны сразу — ради них сюда и приходят.
 * Пробелы в данных убраны под раскрытие, чтобы не удлинять блок.
 */
function AnswerBlock({
  answer,
  materials,
  onWrite,
  writing,
  writeStep,
  disabled,
}: {
  answer: ResearchAnswer;
  materials: ResearchMaterial[];
  onWrite: () => void;
  writing: boolean;
  writeStep: string;
  disabled: boolean;
}) {
  const [gapsOpen, setGapsOpen] = useState(false);
  const byId = new Map(materials.map((m) => [m.id, m]));
  const copyText = [
    answer.summary,
    ...answer.points.map((p) => `— ${p.text}`),
    answer.gaps.length ? `\nОсталось без ответа:\n${answer.gaps.map((g) => `— ${g}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <section className="card flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="t-kicker">Ответ по теме</span>
          <p className="t-content max-w-[70ch] text-fg">{answer.summary}</p>
        </div>
        <CopyButton text={copyText} label="Копировать ответ" variant="ghost" size="sm" />
      </div>

      {answer.points.length > 0 && (
        <ol className="flex flex-col gap-2.5">
          {answer.points.map((p, i) => (
            <li key={i} className="flex gap-3">
              <span className="t-meta mt-1 shrink-0 text-faint">{String(i + 1).padStart(2, "0")}</span>
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="t-body-sm text-fg">{p.text}</span>
                {p.materialIds.length > 0 && (
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    {p.materialIds.map((id) => {
                      const m = byId.get(id);
                      if (!m) return null;
                      return (
                        <a
                          key={id}
                          href={m.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="link t-micro"
                          title={m.title}
                        >
                          {m.outlet}
                        </a>
                      );
                    })}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}

      {answer.gaps.length > 0 && (
        <div className="rule flex flex-col gap-1.5 pt-3">
          <Toggle open={gapsOpen} onToggle={() => setGapsOpen((v) => !v)} label="Чего нет в найденных материалах">
            <span className="t-kicker text-warn">Осталось без ответа: {answer.gaps.length}</span>
          </Toggle>
          <Panel open={gapsOpen}>
            <ul className="flex flex-col gap-1 pt-1 pl-6">
              {answer.gaps.map((g, i) => (
                <li key={i} className="t-body-sm text-fg-soft">
                  {g}
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      )}

      <div className="rule flex flex-wrap items-center gap-3 pt-4">
        <Button variant="primary" size="md" onClick={onWrite} disabled={disabled || writing}>
          {writing ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Sparkles size={16} aria-hidden />}
          {writing ? writeStep || "Пишу…" : "Сгенерировать контент по теме"}
        </Button>
        <span className="t-body-sm text-muted">Сторис, карусель и рилс из этих же материалов.</span>
      </div>
    </section>
  );
}
