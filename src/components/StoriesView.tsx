"use client";

import { Camera, ImageIcon, Type } from "lucide-react";
import type { Edition } from "@/lib/schema";
import { frameText, storiesTextsOnly, storiesToText } from "@/lib/to-text";
import { cn } from "@/lib/utils";
import { FadeUp, Stagger } from "./motion";
import { Mark } from "./ui/Badge";
import { CopyButton } from "./ui/CopyButton";
import { Section } from "./ui/Section";

/**
 * Тип визуала угадывается по ключевым словам. Если ни одно не совпало — возвращаем null:
 * подпись не рендерится вовсе. Врать «Текст на фоне» про кадр, о котором ничего не известно,
 * нельзя — это инструкция по съёмке, а не украшение.
 */
function visualKind(visual: string): { icon: React.ReactNode; label: string } | null {
  const v = visual.toLowerCase();
  if (v.includes("селфи") || v.includes("видео")) return { icon: <Camera size={13} aria-hidden />, label: "Селфи-видео" };
  if (v.includes("скриншот")) return { icon: <ImageIcon size={13} aria-hidden />, label: "Скриншот" };
  if (v.includes("текст") || v.includes("надпись") || v.includes("фон"))
    return { icon: <Type size={13} aria-hidden />, label: "Текст на фоне" };
  return null;
}

/**
 * Настоящий интерактив кадра. Модель вместо пустого поля пишет «нет» или «—»,
 * и такая заглушка превращалась в блок «Интерактив: нет», лишнюю кнопку
 * копирования и завышенный счётчик в подписи секции.
 */
const NO_INTERACTIVE = new Set(["нет", "не", "—", "-", "–", "none", "no", "n/a", "н/д", "отсутствует", "не нужен", "не требуется"]);

function realInteractive(f: { interactive?: string }): string | null {
  const v = (f.interactive ?? "").trim();
  if (!v) return null;
  const key = v.toLowerCase().replace(/[.!]+$/, "");
  if (NO_INTERACTIVE.has(key) || key.length < 5) return null;
  return v;
}

/** Квадратная кнопка-иконка: 32×32 на мыши, на тач-экранах Button сам растянет её до 44. */
const ICON_BTN = "w-8 px-0";

/** На тач-устройствах кнопки копирования видны всегда, на десктопе — по наведению и по фокусу. */
const COPY_COL =
  "flex flex-row items-center gap-1 opacity-0 transition-opacity duration-[var(--t-fast)] group-hover:opacity-100 group-focus-within:opacity-100 [@media(pointer:coarse)]:opacity-100";

export function StoriesView({ edition }: { edition: Edition }) {
  const frames = edition.stories.frames;
  return (
    <Section
      eyebrow="Формат A"
      title="Сторис — сторителлинг"
      description={`${frames.length} кадров · ${frames.filter((f) => realInteractive(f)).length} интерактива`}
      actions={
        <>
          <CopyButton text={storiesToText(edition)} label="Копировать всё с пометками" variant="secondary" />
          <CopyButton text={storiesTextsOnly(edition)} label="Копировать только тексты" variant="ghost" />
        </>
      }
    >
      <Stagger
        tabIndex={0}
        role="group"
        aria-label="Кадры сторис"
        className={cn(
          "scroll-x -mx-4 flex snap-x gap-4 px-4 pb-3",
          "md:mx-0 md:grid md:snap-none md:grid-cols-[repeat(auto-fill,minmax(320px,1fr))] md:px-0 md:pb-0",
          "rounded-[4px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        )}
      >
        {frames.map((f) => {
          const kind = visualKind(f.visual);
          const interactive = realInteractive(f);
          const num = String(f.n).padStart(2, "0");
          return (
            <FadeUp
              key={f.n}
              as="article"
              className={cn(
                "card group grid w-[260px] shrink-0 snap-start gap-x-2 p-5 md:w-auto",
                // Номер и кнопки — в шапке карточки, текст во всю ширину.
                // Боковой жёлоб на 9:16 отнимал половину строки и рвал слова.
                "grid-cols-[minmax(0,1fr)_auto] grid-rows-[auto_minmax(0,1fr)]",
                // Высота по содержимому: карточки в одном ряду сетка выравнивает сама.
                // Жёсткое 9:16 растягивало каждую до 570px и оставляло пустоту на пол-экрана.
                "min-h-[220px]",
              )}
            >
              {/* В жёлоб 44px подпись типа кадра не влезает и рассыпается по буквам,
                  а внизу карточки она и так написана словами в строке «На экране».
                  Здесь остаётся только иконка — с подписью для чтения с экрана. */}
              <div className="col-start-1 row-start-1 flex flex-row items-center gap-2">
                <span className="t-meta text-faint">{num}</span>
                {kind && (
                  <span className="flex text-muted" title={kind.label}>
                    {kind.icon}
                    <span className="sr-only">{kind.label}</span>
                  </span>
                )}
              </div>

              <div className={cn(COPY_COL, "col-start-2 row-start-1")}>
                <CopyButton
                  iconOnly
                  variant="ghost"
                  size="sm"
                  text={frameText(f)}
                  label={`Копировать текст кадра ${f.n}`}
                  className={ICON_BTN}
                />
                {interactive && (
                  <CopyButton
                    iconOnly
                    variant="ghost"
                    size="sm"
                    text={interactive}
                    label={`Копировать интерактив кадра ${f.n}`}
                    className={ICON_BTN}
                  />
                )}
              </div>

              <div className="col-span-2 col-start-1 row-start-2 flex h-full min-w-0 flex-col">
                {/* font-semibold! — .t-content задаёт вес 500 вне слоёв, утилита без ! проиграет */}
                <p className="t-content mt-3 max-w-[34ch] font-semibold! [text-wrap:pretty]">{f.text}</p>
                {/* Инструкция по съёмке видна всегда — даже когда у кадра есть интерактив. */}
                <div className="mt-auto flex flex-col gap-2 pt-5">
                  <p className="t-caption">
                    <span className="t-kicker">На экране</span> {f.visual}
                  </p>
                  {interactive && (
                    <div className="mark flex flex-col items-start gap-1.5 text-accent">
                      <Mark tone="accent">Интерактив</Mark>
                      <span className="t-body-sm text-fg">{interactive}</span>
                    </div>
                  )}
                </div>
              </div>
            </FadeUp>
          );
        })}
      </Stagger>
    </Section>
  );
}
