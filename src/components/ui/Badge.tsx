"use client";

import { ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";
import type { Confidence, Level } from "@/lib/schema";
import { CONFIDENCE_LABEL, LEVEL_LABEL, cn } from "@/lib/utils";

export type Tone = "neutral" | "accent" | "ok" | "warn" | "bad";

const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-muted",
  accent: "text-accent",
  ok: "text-ok",
  warn: "text-warn",
  bad: "text-bad",
};

const TONE_CHIP: Record<Tone, string> = {
  neutral: "bg-surface-2 text-muted border-line",
  accent: "bg-accent-soft text-accent border-transparent",
  ok: "bg-ok-soft text-ok border-transparent",
  warn: "bg-warn-soft text-warn border-transparent",
  bad: "bg-bad-soft text-bad border-transparent",
};

/** Точка 7px. Цвет берёт у родителя, поэтому рядом всегда стоит слово. */
function Dot({ className }: { className?: string }) {
  return <span className={cn("size-[7px] shrink-0 rounded-full bg-current", className)} aria-hidden />;
}

/**
 * Служебная метка: моноширинный UPPERCASE и точка. Ею размечаются статусы —
 * «СЕГОДНЯШНИЙ ВЫПУСК», «ОСТАНОВЛЕНО ВРУЧНУЮ», «ОТКРЫТ». Плашкой не заливается:
 * в полосе состояние обозначается набором, а не цветным прямоугольником.
 */
export function Mark({
  children,
  tone = "neutral",
  dot = true,
  className,
}: {
  children: React.ReactNode;
  tone?: Tone;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-2 font-mono text-[10px] leading-none font-bold tracking-[0.12em] uppercase",
        TONE_TEXT[tone],
        className,
      )}
    >
      {dot && <Dot />}
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

export function Chip({
  children,
  className,
  tone = "neutral",
}: {
  children: React.ReactNode;
  className?: string;
  tone?: Tone;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 max-w-full items-center gap-1.5 rounded-full border px-2 font-mono text-[10px] leading-none font-bold tracking-[0.12em] whitespace-nowrap uppercase",
        TONE_CHIP[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const LEVEL_DOT: Record<Level, string> = {
  world: "bg-lv-world",
  kz: "bg-lv-kz",
  cis: "bg-lv-cis",
  science: "bg-lv-science",
};

/**
 * Уровень: точка цвета --lv-* плюс слово. Слово набирается цветом текста всегда —
 * цвет один информацию не несёт. Казахстанские факты дополнительно помечены
 * акцентной подложкой, но и без неё подпись читается.
 */
export function LevelChip({ level }: { level: Level }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 max-w-full items-center gap-1.5 rounded-full border px-2 font-mono text-[10px] leading-none font-bold tracking-[0.12em] whitespace-nowrap text-fg uppercase",
        level === "kz" ? "border-transparent bg-accent-soft" : "border-line bg-surface-2",
      )}
    >
      <span className={cn("size-[7px] shrink-0 rounded-full", LEVEL_DOT[level])} aria-hidden />
      {LEVEL_LABEL[level]}
    </span>
  );
}

export function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  const map = {
    high: { tone: "ok" as const, Icon: ShieldCheck },
    medium: { tone: "warn" as const, Icon: ShieldAlert },
    low: { tone: "bad" as const, Icon: ShieldX },
  };
  const { tone, Icon } = map[confidence];
  return (
    <span
      className={cn(
        "inline-flex h-6 max-w-full items-center gap-1.5 font-mono text-[10px] leading-none font-bold tracking-[0.12em] whitespace-nowrap uppercase",
        TONE_TEXT[tone],
      )}
    >
      <Dot />
      <Icon size={13} strokeWidth={2.5} aria-hidden />
      {CONFIDENCE_LABEL[confidence]}
    </span>
  );
}
