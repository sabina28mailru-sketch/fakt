"use client";

import { motion, useReducedMotion, type Variants } from "framer-motion";
import { cn } from "@/lib/utils";

export const EASE = [0.2, 0.8, 0.2, 1] as const;

/** Пружина только для layoutId-индикаторов. */
export const SPRING = { type: "spring" as const, stiffness: 420, damping: 38, mass: 0.6 };

/** Длительности продублированы из globals.css, чтобы Framer и CSS не расходились. */
export const T = { fast: 0.09, base: 0.14, move: 0.22, big: 0.32 } as const;

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 6 },
  show: { opacity: 1, y: 0, transition: { duration: T.move, ease: EASE } },
};

export const stagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.03, delayChildren: 0 } },
};

/**
 * Стаггер без хвоста: в длинных списках задержка копится и двадцатая строка
 * доезжает через секунду. После восьмого элемента появление мгновенное.
 */
const STAGGER_LIMIT = 8;

export const fadeUpAt = (index: number): Variants => ({
  hidden: { opacity: 0, y: 6 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: T.move, ease: EASE, delay: index < STAGGER_LIMIT ? index * 0.03 : 0 },
  },
});

type Rest = Record<string, unknown>;

/** Контейнер, который по очереди показывает детей (FadeUp). */
export function Stagger({
  children,
  className,
  as: Tag = "div",
  ...rest
}: {
  children: React.ReactNode;
  className?: string;
  as?: "div" | "ul" | "ol" | "section";
} & Rest) {
  const reduce = useReducedMotion();
  const Comp = motion[Tag];
  return (
    <Comp
      className={className}
      variants={reduce ? undefined : stagger}
      initial={reduce ? false : "hidden"}
      animate="show"
      {...rest}
    >
      {children}
    </Comp>
  );
}

export function FadeUp({
  children,
  className,
  as: Tag = "div",
  ...rest
}: {
  children: React.ReactNode;
  className?: string;
  as?: "div" | "li" | "article" | "section";
} & Rest) {
  const reduce = useReducedMotion();
  const Comp = motion[Tag];
  return (
    <Comp className={cn(className)} variants={reduce ? undefined : fadeUp} {...rest}>
      {children}
    </Comp>
  );
}

/**
 * Кликабельная карточка. Подъёма при наведении нет: в полосе ничего не парит —
 * отклик даёт граница и подчёркивание заголовка.
 */
export function HoverCard({
  children,
  className,
  onClick,
  ...rest
}: {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
} & Rest) {
  const reduce = useReducedMotion();
  return (
    <motion.div className={className} onClick={onClick} variants={reduce ? undefined : fadeUp} {...rest}>
      {children}
    </motion.div>
  );
}
