"use client";

import { motion, useReducedMotion } from "framer-motion";
import { SPRING } from "@/components/motion";
import { cn } from "@/lib/utils";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: React.ReactNode;
  hint?: string;
}

/**
 * Ряд вкладок без пилюли-подложки: строка с линейкой снизу, активная вкладка
 * отмечена общим 2px акцентным отрезком (layoutId), который переезжает пружиной.
 */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  layoutId,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: SegmentedOption<T>[];
  layoutId: string;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <div
      role="tablist"
      className={cn("scroll-x relative flex max-w-full items-stretch gap-1 border-b border-line", className)}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={cn(
              // tablist — скролл-контейнер, поэтому кольцо фокуса рисуем внутрь кнопки: со смещением наружу его срезает overflow.
              "relative flex h-11 shrink-0 items-center gap-2 rounded-t-[4px] px-3 text-[12px] font-bold whitespace-nowrap transition-colors duration-150 focus-visible:-outline-offset-2 sm:px-4",
              active ? "text-fg" : "text-muted hover:text-fg",
            )}
          >
            {o.icon}
            <span>{o.label}</span>
            {o.hint && <span className="t-meta hidden text-faint sm:inline">{o.hint}</span>}
            {active && (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-x-0 bottom-0 h-0.5 bg-accent"
                initial={false}
                transition={reduce ? { duration: 0 } : SPRING}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
