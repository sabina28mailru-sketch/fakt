"use client";

import { ExternalLink } from "lucide-react";
import type { Edition } from "@/lib/schema";
import { hostOf } from "@/lib/utils";
import { FadeUp, Stagger } from "./motion";
import { Section } from "./ui/Section";

export function ExpertLens({ edition }: { edition: Edition }) {
  if (!edition.expertLens.length) return null;
  return (
    <Section
      id="expert-lens"
      eyebrow="Экспертная линза"
      title="Что говорят о проявленности сильные практики"
      description="Дословно, с ссылкой и датой."
    >
      <Stagger className="grid grid-cols-1 gap-x-8 gap-y-6 @min-[680px]:grid-cols-2 @min-[1100px]:grid-cols-3">
        {edition.expertLens.map((q, i) => (
          <FadeUp key={i} as="article" className="rule flex flex-col pt-5">
            {/* Врезка вместо иконки: цвет живёт в линейке, текст цитаты остаётся основным */}
            <blockquote className="mark flex-1 text-accent">
              <p className="t-quote text-fg">«{q.quote}»</p>
            </blockquote>
            <footer className="rule mt-5 pt-3">
              <div className="text-[13px] font-bold">{q.name}</div>
              {q.role && <div className="t-caption mt-0.5">{q.role}</div>}
              <a
                href={q.url}
                target="_blank"
                rel="noreferrer noopener"
                className="link mt-2 inline-flex items-center gap-1 text-[11px] font-semibold"
              >
                {q.source}
                {q.date ? ` · ${q.date}` : ""}
                <ExternalLink size={12} className="shrink-0" aria-hidden />
              </a>
              <div className="sr-only">{hostOf(q.url)}</div>
              {q.note && <p className="t-caption mt-2">{q.note}</p>}
            </footer>
          </FadeUp>
        ))}
      </Stagger>
    </Section>
  );
}
