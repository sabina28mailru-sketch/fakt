"use client";

import { TriangleAlert, X } from "lucide-react";
import { useId, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Приводит строку к голому домену: без протокола, www, пути, порта и регистра.
 * Люди вставляют ссылки целиком — «https://www.kapital.kz/news/123» должен стать «kapital.kz»,
 * иначе фильтр поиска в pipeline.ts не совпадёт ни с одним результатом.
 */
export function normalizeDomain(raw: string): string {
  let s = raw.trim().toLowerCase();
  if (!s) return "";
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  s = s.split(/[/?#]/)[0] ?? "";
  s = s.replace(/^www\./, "");
  s = s.replace(/:\d+$/, "");
  s = s.replace(/^\.+|\.+$/g, "");
  return s;
}

const DOMAIN_RE = /^[^\s/@:,]+\.[^\s/@:,]{2,}$/;

export function isValidDomain(domain: string): boolean {
  return DOMAIN_RE.test(domain);
}

export function domainsWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "домен";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "домена";
  return "доменов";
}

type Note = { kind: "warn" | "bad"; text: string } | null;

/**
 * Редактор списка доменов: чипы + поле ввода.
 * Этот список — настоящий фильтр поиска, поэтому он показывает счётчик
 * и честно предупреждает, когда блок оказался пустым.
 */
export function DomainEditor({
  value,
  onChange,
  disabled,
  label,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  disabled?: boolean;
  label: string;
}) {
  const [text, setText] = useState("");
  const [note, setNote] = useState<Note>(null);
  const inputId = useId();

  function commit(raw: string) {
    const parts = raw
      .split(/[\s,;]+/)
      .map(normalizeDomain)
      .filter(Boolean);
    if (parts.length === 0) {
      setText("");
      setNote(null);
      return;
    }
    const next = [...value];
    const bad: string[] = [];
    let dupes = 0;
    for (const p of parts) {
      if (!isValidDomain(p)) {
        bad.push(p);
        continue;
      }
      if (next.includes(p)) {
        dupes += 1;
        continue;
      }
      next.push(p);
    }
    if (bad.length > 0) {
      setNote({ kind: "bad", text: `Не похоже на домен: ${bad.join(", ")}` });
    } else if (dupes > 0) {
      setNote({ kind: "warn", text: dupes === 1 ? "Уже в списке" : `Уже в списке: ${dupes}` });
    } else {
      setNote(null);
    }
    if (next.length !== value.length) onChange(next);
    // Неразобранное оставляем в поле, чтобы человек мог поправить опечатку, а не набирать заново.
    setText(bad.join(", "));
  }

  function remove(domain: string) {
    onChange(value.filter((d) => d !== domain));
    setNote(null);
  }

  const empty = value.length === 0;

  return (
    <div className="flex flex-col gap-3">
      <ul
        className="flex flex-wrap gap-1.5"
        aria-label={`Домены блока «${label}»`}
      >
        {value.map((d) => (
          <li key={d}>
            <span
              className={cn(
                // Высота чипа — var(--row): 36px под мышью и 44px на тач-экранах,
                // чтобы крестик удаления дотягивался до полноразмерной тач-цели.
                "inline-flex h-[var(--row)] max-w-full items-center gap-1 rounded-[4px] border border-line bg-surface-2 pl-2.5 text-[10.5px] text-fg",
                "font-mono",
                disabled ? "pr-2.5 opacity-60" : "pr-1",
              )}
            >
              <span className="truncate">{d}</span>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => remove(d)}
                  aria-label={`Удалить ${d}`}
                  className={cn(
                    "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[2px] text-muted transition-colors hover:bg-surface-3 hover:text-fg",
                    // Под мышью крестик остаётся компактным, пальцу даём 44×44.
                    "[@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11",
                  )}
                >
                  <X size={12} aria-hidden />
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>

      {!disabled && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={inputId} className="t-kicker">
            Добавить домен
          </label>
          <input
            id={inputId}
            value={text}
            placeholder="kapital.kz, forbes.kz"
            spellCheck={false}
            autoComplete="off"
            aria-describedby={note ? `${inputId}-note` : undefined}
            aria-invalid={note?.kind === "bad" ? true : undefined}
            onChange={(e) => {
              setText(e.target.value);
              if (note) setNote(null);
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                commit(text);
                return;
              }
              if (e.key === "Backspace" && text === "" && value.length > 0) {
                e.preventDefault();
                remove(value[value.length - 1]);
              }
            }}
            onPaste={(e) => {
              const pasted = e.clipboardData.getData("text");
              if (!/[\s,;]/.test(pasted)) return;
              e.preventDefault();
              commit(`${text} ${pasted}`);
            }}
            onBlur={() => {
              if (text.trim() !== "") commit(text);
            }}
            className={cn(
              "h-11 w-full rounded-none border-b bg-transparent pb-px font-mono text-[11.5px] text-fg outline-none transition-colors placeholder:text-faint focus:border-b-2 focus:pb-0",
              note?.kind === "bad"
                ? "border-bad focus:border-bad"
                : note?.kind === "warn"
                  ? "border-warn focus:border-warn"
                  : "border-line focus:border-accent",
            )}
          />
          <p className="t-body-sm text-muted">
            Enter или запятая добавляют домен. Можно вставить сразу список — адреса почистятся сами.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2" role="status" aria-live="polite">
        <span className={cn("t-meta", empty ? "text-warn" : "text-muted")}>
          {value.length} {domainsWord(value.length)}
        </span>
        {note && (
          <span
            id={`${inputId}-note`}
            className={cn("t-body-sm", note.kind === "bad" ? "text-bad" : "text-warn")}
          >
            {note.text}
          </span>
        )}
      </div>

      {empty && (
        <p className="mark t-body-sm border-l-2 border-warn text-warn">
          Список пуст — поиск по этому блоку не даст ничего: запросы уйдут в никуда.
        </p>
      )}

      {!empty && note === null && disabled && (
        <p className="t-body-sm flex items-center gap-2 text-muted">
          <TriangleAlert size={14} className="shrink-0 text-warn" aria-hidden />
          В превью список доменов только для чтения.
        </p>
      )}
    </div>
  );
}
