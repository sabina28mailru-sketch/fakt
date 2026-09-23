"use client";

import { cn } from "@/lib/utils";

/**
 * Каркас раздела полосы: линейка сверху, надстрочник, заголовок, лид и слот
 * действий, прижатый к низу заголовочного блока. Карточки с тенью нет —
 * разделы отделяются друг от друга правилом.
 */
export function Section({
  eyebrow,
  title,
  description,
  actions,
  children,
  className,
  id,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cn("rule flex flex-col gap-6 pt-6", className)}>
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          {eyebrow && <div className="t-label mb-2">{eyebrow}</div>}
          <h2 className="t-d2">{title}</h2>
          {description && <p className="t-deck mt-2">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      {children}
    </section>
  );
}
