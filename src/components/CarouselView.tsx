"use client";

import type { Edition } from "@/lib/schema";
import { carouselTextsOnly, carouselToText, slideText } from "@/lib/to-text";
import { cn } from "@/lib/utils";
import { FadeUp, Stagger } from "./motion";
import { CopyButton } from "./ui/CopyButton";
import { Section } from "./ui/Section";

/** Квадратная кнопка-иконка: 32×32 на мыши, на тач-экранах Button сам растянет её до 44. */
const ICON_BTN = "w-8 px-0";

const COPY_BTN =
  "opacity-0 transition-opacity duration-[var(--t-fast)] group-hover:opacity-100 group-focus-within:opacity-100 [@media(pointer:coarse)]:opacity-100";

/**
 * Кикер слайда. На инвертированной плашке (.ink-block) цвет наследуется от неё:
 * класс .t-label жёстко красит текст в --muted и на инверсии дал бы грязный контраст.
 */
function SlideKicker({ ink, children }: { ink: boolean; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "font-mono text-[10px] leading-none font-bold tracking-[0.14em] uppercase",
        ink ? "text-current" : "text-muted",
      )}
    >
      {children}
    </span>
  );
}

export function CarouselView({ edition }: { edition: Edition }) {
  const { slides, caption } = edition.carousel;
  const last = slides.length;
  return (
    <Section
      eyebrow="Формат B"
      title="Карусель"
      description={`Обложка, ${last - 2} слайдов и финал с призывом. Заголовок до 60 знаков, текст до 250.`}
      actions={
        <>
          <CopyButton text={carouselToText(edition)} label="Копировать слайды и подпись" variant="secondary" />
          <CopyButton text={carouselTextsOnly(edition)} label="Копировать только тексты" variant="ghost" />
        </>
      }
    >
      <Stagger className="grid grid-cols-1 gap-4 @min-[680px]:grid-cols-2 @min-[1080px]:grid-cols-3">
        {slides.map((s) => {
          const cover = s.n === 1;
          const final = s.n === last;
          const ink = cover || final;
          return (
            <FadeUp
              key={s.n}
              as="article"
              className={cn("card group relative flex flex-col p-6", ink && "ink-block")}
            >
              <div className="flex items-center gap-3">
                <span className={cn("t-meta", ink ? "text-current" : "text-faint")}>
                  {String(s.n).padStart(2, "0")} / {String(last).padStart(2, "0")}
                </span>
                <SlideKicker ink={ink}>{cover ? "Обложка" : final ? "Финал" : "Слайд"}</SlideKicker>
                <div className={cn("ml-auto -mt-1 -mr-1", COPY_BTN)}>
                  <CopyButton
                    iconOnly
                    variant="ghost"
                    size="sm"
                    text={slideText(s)}
                    label={`Копировать слайд ${s.n}`}
                    className={cn(ICON_BTN, ink && "text-ink-fg enabled:hover:bg-ink-fg/10 enabled:hover:text-ink-fg")}
                  />
                </div>
              </div>
              {/* .t-d3 задаёт кегль вне слоёв, поэтому у обложки свой класс, а не переопределение */}
              <h3 className={cn("mt-4", cover ? "display text-[19px] leading-tight font-semibold" : "t-d3")}>
                {s.title}
              </h3>
              {/* Обложка и финал держат контраст весом (700 против 500), а не прозрачностью текста. */}
              <p className={cn("t-content mt-3 max-w-[42ch] [text-wrap:pretty]", ink && "font-bold!")}>{s.body}</p>
            </FadeUp>
          );
        })}
      </Stagger>

      <div className="rule pt-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <span className="t-label">Подпись к посту · {caption.length} знаков</span>
          <CopyButton text={caption} label="Копировать подпись" variant="ghost" />
        </div>
        <p className="t-content max-w-[72ch] whitespace-pre-line [text-wrap:pretty]">{caption}</p>
      </div>
    </Section>
  );
}
