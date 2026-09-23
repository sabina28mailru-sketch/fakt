"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { Edition, Level } from "@/lib/schema";
import { factsToText } from "@/lib/to-text";
import { cn, hostOf } from "@/lib/utils";
import { FadeUp, Stagger, fadeUpAt } from "./motion";
import { ConfidenceBadge, LevelChip } from "./ui/Badge";
import { CopyButton } from "./ui/CopyButton";
import { Section } from "./ui/Section";

/** Левое правило строки: единственное место, где уровень говорит цветом. Слово рядом обязательно. */
const LEVEL_RULE: Record<Level, string> = {
  world: "border-l-lv-world",
  kz: "border-l-lv-kz",
  cis: "border-l-lv-cis",
  science: "border-l-lv-science",
};

const COLUMNS = ["Факт", "Источник", "Дата", "Уровень", "Уверенность"];

/** Одна строка для буфера: формулировка и источник, чтобы вставлять в переписку. */
function factLine(f: Edition["facts"][number]) {
  return `${f.fact} — ${f.source}, ${f.date}: ${f.url}`;
}

export function FactsTable({ edition }: { edition: Edition }) {
  const facts = edition.facts;
  const reduce = useReducedMotion();
  // Липкая шапка нужна только длинным таблицам: на десяти строках она лишь мешает.
  const stickyHead = facts.length > 20;

  const anim = (i: number) =>
    reduce ? {} : { variants: fadeUpAt(i), initial: "hidden" as const, animate: "show" as const };

  return (
    <Section
      id="facts"
      eyebrow="Факты и источники"
      title={`${facts.length} фактов, каждый — с ссылкой`}
      description="Высокая — первоисточник открыт. Средняя — совпадает в двух независимых публикациях."
      actions={<CopyButton text={factsToText(edition)} label="Копировать список" variant="secondary" />}
    >
      {/* Мобильные: те же записи списком через hairline, без рамок */}
      <Stagger className="flex flex-col md:hidden">
        {facts.map((f, i) => (
          <FadeUp key={i} as="article" className="rule flex flex-col gap-2 py-4">
            <div className="flex items-start gap-2">
              <p className="t-content min-w-0 flex-1">{f.fact}</p>
              <CopyButton
                iconOnly
                variant="ghost"
                size="sm"
                text={factLine(f)}
                label={`Копировать факт ${i + 1} с источником`}
              />
            </div>
            {f.note && <p className="t-caption">{f.note}</p>}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <LevelChip level={f.level} />
              <ConfidenceBadge confidence={f.confidence} />
              <span className="t-meta tabular ml-auto text-muted">{f.date}</span>
            </div>
            <div>
              <a href={f.url} target="_blank" rel="noreferrer noopener" className="link text-[13px] font-semibold">
                {f.source}
              </a>
              <div className="t-micro mt-0.5">{hostOf(f.url)}</div>
            </div>
          </FadeUp>
        ))}
      </Stagger>

      {/* Десктоп: таблица. Контейнер прокручивается, поэтому он фокусируемый — иначе с клавиатуры не доехать вбок. */}
      <div
        tabIndex={0}
        role="region"
        aria-label="Таблица фактов, прокручивается по горизонтали"
        className="scroll-x hidden focus-visible:outline-2 focus-visible:outline-accent md:block"
      >
        <table className="w-full min-w-[680px] border-collapse text-left">
          <thead>
            <tr>
              {COLUMNS.map((h) => (
                <th
                  key={h}
                  scope="col"
                  className={cn(
                    "t-kicker border-b-2 border-line-strong px-4 py-3 text-[10px] tracking-[0.12em]",
                    stickyHead && "sticky top-16 z-10 bg-bg",
                  )}
                >
                  {h}
                </th>
              ))}
              <th
                scope="col"
                className={cn(
                  "border-b-2 border-line-strong px-2 py-3",
                  stickyHead && "sticky top-16 z-10 bg-bg",
                )}
              >
                <span className="sr-only">Копировать факт</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {facts.map((f, i) => (
              // Зебры нет: строку подсвечивает наведение, уровень — левое правило
              <motion.tr key={i} className="row-hover align-top" {...anim(i)}>
                <td
                  className={cn(
                    "max-w-[46ch] min-w-[300px] border-b border-line border-l-2 px-4 py-3.5",
                    LEVEL_RULE[f.level],
                  )}
                >
                  <p className="t-content">{f.fact}</p>
                  {f.note && <p className="t-caption mt-1">{f.note}</p>}
                </td>
                <td className="border-b border-line px-4 py-3.5">
                  <a
                    href={f.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="link block max-w-[24ch] text-[13px] font-semibold"
                  >
                    {f.source}
                  </a>
                  <div className="t-micro mt-1">{hostOf(f.url)}</div>
                </td>
                <td className="t-meta tabular border-b border-line px-4 py-3.5 whitespace-nowrap text-muted">
                  {f.date}
                </td>
                <td className="border-b border-line px-4 py-3.5">
                  <LevelChip level={f.level} />
                </td>
                <td className="border-b border-line px-4 py-3.5">
                  <ConfidenceBadge confidence={f.confidence} />
                </td>
                <td className="border-b border-line px-2 py-3.5">
                  <CopyButton
                    iconOnly
                    variant="ghost"
                    size="sm"
                    text={factLine(f)}
                    label={`Копировать факт ${i + 1} с источником`}
                  />
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
