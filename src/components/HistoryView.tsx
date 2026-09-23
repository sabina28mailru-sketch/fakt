"use client";

import { ArrowRight, Newspaper } from "lucide-react";
import { useMemo } from "react";
import { useReducedMotion, motion } from "framer-motion";
import type { Edition } from "@/lib/schema";
import { cn, formatDateRu, formatTimeRu, plural } from "@/lib/utils";
import { fadeUpAt } from "./motion";
import { Mark } from "./ui/Badge";
import { Section } from "./ui/Section";

const MONTHS_RU_NOM = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
];

export function HistoryView({
  editions,
  currentId,
  onOpen,
  timeZone,
}: {
  editions: Edition[];
  currentId?: string;
  onOpen: (id: string) => void;
  timeZone: string;
}) {
  const reduce = useReducedMotion();

  const totals = useMemo(() => {
    let facts = 0;
    let high = 0;
    for (const e of editions) {
      facts += e.facts.length;
      high += e.facts.filter((f) => f.confidence === "high").length;
    }
    return { facts, high, share: facts > 0 ? Math.round((high / facts) * 100) : 0 };
  }, [editions]);

  // Выпуски сгруппированы по месяцам: заголовок месяца должен быть соседом своих строк, иначе sticky держится только высотой одной строки.
  const months = useMemo(() => {
    const out: { key: string; date: string; items: { edition: Edition; index: number }[] }[] = [];
    editions.forEach((edition, index) => {
      const key = edition.date.slice(0, 7);
      const last = out[out.length - 1];
      if (last && last.key === key) last.items.push({ edition, index });
      else out.push({ key, date: edition.date, items: [{ edition, index }] });
    });
    return out;
  }, [editions]);

  return (
    <Section
      eyebrow="История"
      title={`Архив · ${editions.length} ${plural(editions.length, "выпуск", "выпуска", "выпусков")}`}
      description="Каждый выпуск — отдельный JSON в data/editions."
      className="max-w-[900px]"
    >
      {editions.length === 0 ? (
        <div className="panel flex flex-col items-center gap-2 p-10 text-center text-muted">
          <Newspaper size={28} aria-hidden />
          <p>Выпусков пока нет. Нажмите «Сгенерировать выпуск».</p>
        </div>
      ) : (
        <>
          <dl className="rule grid grid-cols-2 gap-x-6 gap-y-4 pt-4 @min-[640px]:grid-cols-4">
            <Stat label="Выпусков" value={String(editions.length)} />
            <Stat label="Всего фактов" value={String(totals.facts)} />
            <Stat label="Высокая уверенность" value={String(totals.high)} />
            <Stat label="Доля высокой" value={`${totals.share} %`} />
          </dl>

          <ol className="rule-2 mt-2">
            {months.map((g) => (
              <li key={g.key}>
                <MonthRule date={g.date} />
                <ol>
                  {g.items.map(({ edition: e, index }) => {
                    const isCurrent = currentId === e.id;
                    return (
                      <li key={e.id}>
                        <motion.button
                          type="button"
                          onClick={() => onOpen(e.id)}
                          aria-current={isCurrent ? "true" : undefined}
                          aria-label={`Открыть выпуск за ${formatDateRu(e.date)} — ${e.topic.title}`}
                          variants={reduce ? undefined : fadeUpAt(index)}
                          initial={reduce ? false : "hidden"}
                          animate="show"
                          className={cn(
                            "group grid w-full grid-cols-[56px_minmax(0,1fr)] items-start gap-x-4 gap-y-2",
                            "border-b border-l-2 border-b-line py-4 pl-3 text-left transition-colors duration-150",
                            "hover:border-b-line-strong hover:bg-surface-2 focus-visible:bg-surface-2",
                            // Третья колонка обязана быть ограничена: рубрика бывает
                            // длиной в строку, и на auto она выжимала заголовок в столбик по слову.
                            "@min-[640px]:grid-cols-[72px_minmax(0,1fr)_minmax(0,13rem)] @min-[640px]:gap-x-6",
                            isCurrent ? "border-l-accent" : "border-l-transparent",
                          )}
                        >
                          <div className="min-w-0">
                            <div className="tabular font-mono text-[14px] font-semibold">{shortDate(e.date)}</div>
                            {e.createdAt && (
                              <div className="t-micro mt-1">{formatTimeRu(e.createdAt, timeZone)}</div>
                            )}
                          </div>

                          <div className="min-w-0">
                            <h3 className="t-d3 underline-offset-4 group-hover:underline group-focus-visible:underline">
                              {e.topic.title}
                            </h3>
                            <p className="t-meta mt-2 text-muted">{metaLine(e)}</p>
                            <ConfidenceRule facts={e.facts} />
                          </div>

                          <div className="col-span-2 flex min-w-0 items-center justify-between gap-3 @min-[640px]:col-span-1 @min-[640px]:flex-col @min-[640px]:items-end @min-[640px]:justify-start @min-[640px]:gap-2">
                            <span className="t-meta line-clamp-2 min-w-0 break-words text-muted uppercase @min-[640px]:text-right">
                              {e.weekday} · {e.rubric}
                            </span>
                            {isCurrent ? (
                              <Mark tone="accent">Открыт</Mark>
                            ) : (
                              <ArrowRight
                                size={16}
                                className="shrink-0 text-muted transition-transform duration-150 group-hover:translate-x-0.5"
                                aria-hidden
                              />
                            )}
                          </div>
                        </motion.button>
                      </li>
                    );
                  })}
                </ol>
              </li>
            ))}
          </ol>
        </>
      )}
    </Section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="t-label">{label}</dt>
      <dd className="t-stat mt-2">{value}</dd>
    </div>
  );
}

/** Липкий подзаголовок месяца: подшивка листается по месяцам, а не по строкам. */
function MonthRule({ date }: { date: string }) {
  const [y, m] = date.split("-").map(Number);
  const title = m ? `${MONTHS_RU_NOM[m - 1]} ${y}` : date;
  return (
    <div className="t-label sticky top-[var(--bar-top)] z-10 flex h-8 items-center border-b border-line bg-bg">
      {title.toUpperCase()}
    </div>
  );
}

/** Микро-шкала уверенности 120×3px — тот же язык, что и в паспорте выпуска. */
function ConfidenceRule({ facts }: { facts: Edition["facts"] }) {
  const total = facts.length;
  if (total === 0) return null;
  const high = facts.filter((f) => f.confidence === "high").length;
  const medium = facts.filter((f) => f.confidence === "medium").length;
  const low = total - high - medium;
  const seg = [
    { n: high, cls: "bg-ok" },
    { n: medium, cls: "bg-warn" },
    { n: low, cls: "bg-bad" },
  ].filter((s) => s.n > 0);
  return (
    <div className="mt-2 flex h-[3px] w-[120px] max-w-full overflow-hidden bg-surface-3" aria-hidden>
      {seg.map((s) => (
        <span key={s.cls} className={s.cls} style={{ width: `${(s.n / total) * 100}%` }} />
      ))}
    </div>
  );
}

function metaLine(e: Edition) {
  const high = e.facts.filter((f) => f.confidence === "high").length;
  return [
    `${e.stories.frames.length} ${plural(e.stories.frames.length, "кадр", "кадра", "кадров")}`,
    `${e.carousel.slides.length} ${plural(e.carousel.slides.length, "слайд", "слайда", "слайдов")}`,
    `${e.facts.length} ${plural(e.facts.length, "факт", "факта", "фактов")}`,
    `${high} с высокой уверенностью`,
  ].join(" · ");
}

/** "2026-09-18" → "18.09" */
function shortDate(iso: string) {
  const [, m, d] = iso.split("-");
  return m && d ? `${d}.${m}` : iso;
}
