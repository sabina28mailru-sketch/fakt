"use client";

import { ArrowUpRight, TriangleAlert } from "lucide-react";
import type { Edition } from "@/lib/schema";
import { hostOf } from "@/lib/utils";
import { FadeUp, Stagger } from "./motion";
import { Section } from "./ui/Section";

export function BackupTopics({ edition }: { edition: Edition }) {
  return (
    <div className="grid grid-cols-1 gap-10 @min-[760px]:grid-cols-2">
      <Section
        id="backup-topics"
        eyebrow="На завтра"
        title="Запасные темы"
        description="Инфоповоды, которые прошли проверку, но не стали темой дня."
      >
        <Stagger className="flex flex-col">
          {edition.backupTopics.map((t, i) => (
            <FadeUp key={i} as="article" className="rule py-4">
              <a
                href={t.url}
                target="_blank"
                rel="noreferrer noopener"
                className="group flex items-start justify-between gap-3"
              >
                <span className="text-[14px] leading-snug font-semibold underline decoration-transparent underline-offset-[3px] transition-[text-decoration-color] group-hover:decoration-current group-focus-visible:decoration-current">
                  {t.title}
                </span>
                <ArrowUpRight size={16} className="mt-1 shrink-0 text-accent" aria-hidden />
              </a>
              <div className="t-micro mt-1">{hostOf(t.url)}</div>
              {t.note && <p className="t-caption mt-2">{t.note}</p>}
            </FadeUp>
          ))}
        </Stagger>
      </Section>

      {edition.unverified.length > 0 && (
        <Section
          id="unverified"
          eyebrow="Честно"
          title="Что не удалось проверить"
          description="Это осталось со средней уверенностью или не попало в контент."
        >
          <Stagger as="ul" className="flex flex-col gap-2">
            {edition.unverified.map((u, i) => (
              <FadeUp
                key={i}
                as="li"
                className="t-body-sm flex items-start gap-2.5 border-l-2 border-warn bg-warn-soft px-3.5 py-2.5"
              >
                <TriangleAlert size={15} className="mt-0.5 shrink-0 text-warn" aria-hidden />
                <span className="min-w-0">{u}</span>
              </FadeUp>
            ))}
          </Stagger>
        </Section>
      )}
    </div>
  );
}
