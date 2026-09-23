"use client";

import { Clapperboard } from "lucide-react";
import type { Edition } from "@/lib/schema";
import { reelLineText, reelTextsOnly, reelToText } from "@/lib/to-text";
import { cn } from "@/lib/utils";
import { FadeUp, Stagger } from "./motion";
import { CopyButton } from "./ui/CopyButton";
import { Section } from "./ui/Section";

/** Квадратная кнопка-иконка: 32×32 на мыши, на тач-экранах Button сам растянет её до 44. */
const ICON_BTN = "w-8 px-0";

const COPY_BTN =
  "opacity-0 transition-opacity duration-[var(--t-fast)] group-hover:opacity-100 group-focus-within:opacity-100 [@media(pointer:coarse)]:opacity-100";

export function ReelView({ edition }: { edition: Edition }) {
  const { hook, script, captions, cta, caption } = edition.reel;
  const lastTime = script[script.length - 1]?.time.split("–").pop() ?? "";
  return (
    <Section
      eyebrow="Формат C"
      title="Рилс — текст на камеру"
      description={`${script.length} реплик, хронометраж до ${lastTime}. Хук — первые три секунды.`}
      actions={
        <>
          <CopyButton text={reelToText(edition)} label="Копировать сценарий" variant="secondary" />
          <CopyButton text={reelTextsOnly(edition)} label="Копировать только тексты" variant="ghost" />
        </>
      }
    >
      <div className="grid grid-cols-1 gap-8 @min-[880px]:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] @min-[880px]:gap-12">
        <div className="flex flex-col gap-6">
          <div className="group flex items-start gap-3 border-l-[3px] border-accent pl-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Clapperboard size={16} className="text-accent" aria-hidden />
                <span className="t-label">Хук · 0:00–0:03</span>
              </div>
              <p className="t-hook mt-2 max-w-[24ch] [text-wrap:balance]">{hook}</p>
            </div>
            <div className={cn("-mt-1", COPY_BTN)}>
              <CopyButton iconOnly variant="ghost" size="sm" text={hook} label="Копировать хук" className={ICON_BTN} />
            </div>
          </div>

          <Stagger as="ol" className="flex flex-col">
            {script.map((line, i) => (
              <FadeUp
                key={i}
                as="li"
                className={cn(
                  "row-hover group -mx-2 grid min-h-[var(--row)] items-start gap-x-3 border-b border-line px-2 py-3 last:border-b-0",
                  "grid-cols-[72px_minmax(0,1fr)_auto] @min-[560px]:grid-cols-[88px_minmax(0,1fr)_auto]",
                )}
              >
                <span className="t-meta pt-1 text-accent">{line.time}</span>
                <p className="t-content min-w-0 [text-wrap:pretty]">{line.text}</p>
                <div className={COPY_BTN}>
                  <CopyButton
                    iconOnly
                    variant="ghost"
                    size="sm"
                    text={reelLineText(line)}
                    label={`Копировать реплику ${line.time}`}
                    className={ICON_BTN}
                  />
                </div>
              </FadeUp>
            ))}
          </Stagger>
        </div>

        <div className="flex flex-col gap-6 min-[1100px]:sticky min-[1100px]:top-[120px] min-[1100px]:self-start">
          <div className="rule pt-5">
            <div className="t-label mb-3">Надписи на экране</div>
            <ul className="flex flex-col gap-2">
              {captions.map((c, i) => (
                <li key={i} className="t-body-sm grid grid-cols-[14px_minmax(0,1fr)] gap-1">
                  <span aria-hidden className="text-muted">
                    —
                  </span>
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rule pt-5">
            <div className="t-label mb-3">Финальный призыв</div>
            <p className="t-content font-semibold!">{cta}</p>
          </div>

          <div className="rule pt-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <span className="t-label">Подпись к рилсу</span>
              <CopyButton text={caption} label="Копировать" variant="ghost" />
            </div>
            <p className="t-body-sm max-w-[62ch] whitespace-pre-line text-muted">{caption}</p>
          </div>
        </div>
      </div>
    </Section>
  );
}
