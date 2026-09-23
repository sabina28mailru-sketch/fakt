"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { CheckCircle2, Info, TriangleAlert } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { EASE, T } from "@/components/motion";

type ToastKind = "ok" | "info" | "warn";
interface ToastItem {
  id: number;
  kind: ToastKind;
  text: string;
}

const ToastContext = createContext<(text: string, kind?: ToastKind) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const counter = useRef(0);
  const reduce = useReducedMotion();

  const push = useCallback((text: string, kind: ToastKind = "ok") => {
    const id = ++counter.current;
    setItems((prev) => [...prev.slice(-2), { id, kind, text }]);
    window.setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 2800);
  }, []);

  const icons = useMemo(
    () => ({
      ok: <CheckCircle2 size={16} className="text-ok" aria-hidden />,
      info: <Info size={16} className="text-accent" aria-hidden />,
      warn: <TriangleAlert size={16} className="text-warn" aria-hidden />,
    }),
    [],
  );

  return (
    <ToastContext.Provider value={push}>
      {children}
      {/* --inset-b уже учитывает высоту мобильного дока и safe-area, поэтому
          захардкоженного calc(72px + env(...)) здесь больше нет. */}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-[var(--inset-b)] z-50 flex flex-col items-center gap-2 px-4 lg:items-end lg:px-6"
        aria-live="polite"
      >
        <AnimatePresence>
          {items.map((t) => (
            <motion.div
              key={t.id}
              initial={reduce ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
              transition={{ duration: reduce ? 0 : T.move, ease: EASE }}
              className="pointer-events-auto flex max-w-[92vw] items-center gap-2.5 rounded-lg border border-line bg-surface px-4 py-2.5 text-[12px] font-medium shadow-[var(--shadow)]"
              role="status"
            >
              {icons[t.kind]}
              <span>{t.text}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
