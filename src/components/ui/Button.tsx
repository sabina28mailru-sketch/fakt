"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

/**
 * Главная кнопка — градиент, гаснущий книзу, как в референсе. Контраст держит
 * верхний край: текст читается на самом плотном участке заливки.
 * Осветление и нажатие вешаются только на включённую кнопку, иначе
 * :hover срабатывает и на disabled.
 */
const variants: Record<Variant, string> = {
  primary:
    "btn-gradient enabled:hover:brightness-105 enabled:active:scale-[0.97]",
  secondary:
    "bg-surface-2 text-fg border border-line backdrop-blur-sm enabled:hover:border-line-strong enabled:hover:bg-surface-3",
  ghost: "bg-transparent text-muted border border-transparent enabled:hover:text-fg enabled:hover:bg-surface-2",
  danger: "bg-bad-soft text-bad border border-transparent enabled:hover:brightness-110",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 gap-1.5",
  md: "h-10 px-4 gap-2",
  lg: "h-12 px-5 gap-2",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "secondary", size = "md", type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-lg text-[12px] leading-none font-semibold whitespace-nowrap",
        "transition-[background-color,border-color,color,filter,transform] duration-150",
        "disabled:cursor-not-allowed disabled:opacity-50",
        // Палец не попадает в 32 пиксела: на тач-экранах любая кнопка тянется до 44.
        "[@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
});
