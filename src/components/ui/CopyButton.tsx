"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button, type ButtonProps } from "./Button";
import { useToast } from "./Toast";

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

export function CopyButton({
  text,
  label = "Копировать",
  doneLabel = "Скопировано",
  iconOnly = false,
  className,
  ...props
}: {
  text: string;
  label?: string;
  doneLabel?: string;
  iconOnly?: boolean;
} & Omit<ButtonProps, "onClick" | "children">) {
  const [done, setDone] = useState(false);
  const reduce = useReducedMotion();
  const toast = useToast();
  return (
    <Button
      size="sm"
      {...props}
      aria-label={label}
      title={iconOnly ? label : props.title}
      // Вспышка --copied держится ровно столько же, сколько галочка: копирование видно
      // и тем, кто не смотрит на тост.
      className={cn(done && "bg-copied text-fg", className)}
      onClick={async () => {
        const ok = await copyText(text);
        if (ok) {
          setDone(true);
          toast(doneLabel);
          window.setTimeout(() => setDone(false), 1600);
        } else {
          toast("Не удалось скопировать — выделите текст вручную", "warn");
        }
      }}
    >
      <motion.span
        key={done ? "done" : "idle"}
        className="inline-flex"
        initial={reduce ? false : { scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 25 }}
      >
        {done ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
      </motion.span>
      {!iconOnly && <span>{done ? doneLabel : label}</span>}
    </Button>
  );
}
