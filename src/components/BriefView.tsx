"use client";

import { motion, useReducedMotion } from "framer-motion";
import {
  CheckCircle2,
  Eye,
  Loader2,
  RotateCcw,
  Save,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Settings } from "@/lib/schema";
import { BUCKETS, DEFAULT_SOURCE_DOMAINS, type SourceBucket } from "@/lib/sources";
import { WEEKDAYS_RU, cn, formatDateRu, rubricIndex, todayIso } from "@/lib/utils";
import { FadeUp, Stagger } from "./motion";
import { Mark } from "./ui/Badge";
import { Button } from "./ui/Button";
import { DomainEditor, domainsWord } from "./ui/DomainEditor";
import { Section } from "./ui/Section";
import { Segmented } from "./ui/Segmented";
import { useToast } from "./ui/Toast";

const MODELS = ["gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-3.8-flash"];

type BriefKey = keyof Omit<Settings["brief"], "rubrics">;
type GroupId = "connection" | "rubrics" | "who" | "where" | "truth" | "formats";

const GROUPS: { id: GroupId; label: string; core?: boolean }[] = [
  { id: "connection", label: "Подключение" },
  { id: "rubrics", label: "Рубрики" },
  { id: "who", label: "Кто и о чём" },
  { id: "where", label: "Где искать" },
  { id: "truth", label: "Что считать правдой", core: true },
  { id: "formats", label: "Форматы" },
];

/** Порядок полей сохранён из первой версии брифа, добавлена только разбивка на группы. */
const FIELDS: { key: BriefKey; label: string; hint: string; rows?: number; group: GroupId; bucket?: SourceBucket }[] = [
  { key: "persona", label: "Кто такой ассистент и для кого пишет", hint: "Роль, город, аудитория, язык.", group: "who" },
  { key: "priorities", label: "Приоритеты", hint: "Что важнее: достоверность, интерес, что не обещаем.", group: "who" },
  { key: "sourcesWorld", label: "Источники: мир", hint: "Темы за последние 14 дней и приоритетные издания.", group: "where", bucket: "world" },
  { key: "sourcesKz", label: "Источники: Казахстан", hint: "Медиа, статистика, кейсы.", group: "where", bucket: "kz" },
  { key: "sourcesCis", label: "Источники: СНГ", hint: "Плюс оговорки про российские данные.", group: "where", bucket: "cis" },
  { key: "expertLens", label: "Экспертная линза «проявленность»", hint: "Кого читать и по каким терминам искать.", group: "where" },
  { key: "science", label: "Научная опора", hint: "Исследования, на которые можно ссылаться.", group: "where", bucket: "science" },
  { key: "verification", label: "Правила проверки", hint: "Главный блок: что считается подтверждённым.", rows: 8, group: "truth" },
  { key: "topicRules", label: "Выбор темы дня", hint: "Критерии темы и чего избегать.", group: "truth" },
  { key: "voice", label: "Голос и стиль", hint: "От первого лица, без штампов, цифры с источником.", group: "who" },
  { key: "formatStories", label: "Формат: сторис", hint: "Кадры, интерактивы, длина.", group: "formats" },
  { key: "formatCarousel", label: "Формат: карусель", hint: "Слайды, подпись.", group: "formats" },
  { key: "formatReel", label: "Формат: рилс", hint: "Хук, хронометраж, надписи.", group: "formats" },
];

const BUCKET_LABEL: Record<SourceBucket, string> = {
  world: "Мир",
  kz: "Казахстан",
  cis: "СНГ",
  science: "Наука",
};

const BUCKET_FIELD: Record<SourceBucket, BriefKey> = {
  world: "sourcesWorld",
  kz: "sourcesKz",
  cis: "sourcesCis",
  science: "science",
};

const FALLBACK_TIMEZONES = [
  "Asia/Almaty",
  "Asia/Aqtau",
  "Asia/Aqtobe",
  "Asia/Tashkent",
  "Asia/Bishkek",
  "Europe/Moscow",
  "Europe/Kyiv",
  "Europe/Berlin",
  "Europe/London",
  "Asia/Dubai",
  "Asia/Istanbul",
  "UTC",
];

/** Intl.supportedValuesOf есть не во всех рантаймах и типах — берём аккуратно. */
function timezoneList(): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] };
  try {
    const list = intl.supportedValuesOf?.("timeZone");
    return list && list.length > 0 ? list : FALLBACK_TIMEZONES;
  } catch {
    return FALLBACK_TIMEZONES;
  }
}

function fieldsWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "поле";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "поля";
  return "полей";
}

/* ---------- ошибки валидации по полям ---------- */

/** Ошибка сервера в форме Zod: путь до поля и текст. */
type FieldIssue = { path: (string | number)[]; message: string };

/** Куда на странице ведёт ошибка: элемент, раздел брифа и вкладка доменов. */
type IssueTarget = { id: string; group: GroupId; bucket?: SourceBucket };

/**
 * App бросает обычный Error, но с дополнительным полем issues из ответа /api/settings.
 * Разбираем его защитно: до BriefView долетает и сетевое исключение без issues.
 */
function issuesOf(e: unknown): FieldIssue[] {
  if (!(e instanceof Error)) return [];
  const raw = (e as Error & { issues?: unknown }).issues;
  if (!Array.isArray(raw)) return [];
  const list: FieldIssue[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const { path, message } = item as { path?: unknown; message?: unknown };
    if (typeof message !== "string" || message === "") continue;
    const parts = Array.isArray(path)
      ? path.filter((p): p is string | number => typeof p === "string" || typeof p === "number")
      : [];
    list.push({ path: parts, message });
  }
  return list;
}

/** Путь Zod → id элемента на странице. Неизвестные пути молча игнорируем. */
function targetOf(path: (string | number)[]): IssueTarget | null {
  const [head, second, third] = path;
  if (head === "brief") {
    if (second === "rubrics") {
      const i = typeof third === "number" ? third : Number(third);
      return Number.isInteger(i) ? { id: `rubric-${i}`, group: "rubrics" } : { id: "brief-group-rubrics", group: "rubrics" };
    }
    const field = FIELDS.find((f) => f.key === second);
    return field ? { id: `brief-${field.key}`, group: field.group } : null;
  }
  if (head === "sourceDomains") {
    return { id: "brief-domains", group: "where", bucket: BUCKETS.find((b) => b === second) };
  }
  if (head === "userLocation") {
    return second === "timezone" ? { id: "timezone", group: "connection" } : { id: "city", group: "connection" };
  }
  if (head === "model" || head === "maxSearches" || head === "maxFetches") {
    return { id: head, group: "connection" };
  }
  return null;
}

function FieldError({ id, text }: { id: string; text: string }) {
  return (
    <p id={id} role="alert" className="t-body-sm text-bad">
      {text}
    </p>
  );
}

export function BriefView({
  settings,
  onSave,
  preview,
  draft,
  onDraftChange,
}: {
  settings: Settings;
  onSave: (s: Settings) => Promise<void>;
  preview: boolean;
  draft?: Settings;
  onDraftChange?: (s: Settings) => void;
}) {
  // Черновик живёт в App и переживает смену раздела; без него работаем от сохранённых настроек.
  const cur = draft ?? settings;

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [issues, setIssues] = useState<FieldIssue[]>([]);
  const [checking, setChecking] = useState(false);
  const [health, setHealth] = useState<{ ok: boolean; message: string } | null>(null);
  const [active, setActive] = useState<GroupId>("connection");
  const [domainTab, setDomainTab] = useState<SourceBucket>("kz");
  const [numRaw, setNumRaw] = useState<Partial<Record<"maxSearches" | "maxFetches", string>>>({});
  const toast = useToast();
  const reduce = useReducedMotion();

  const dirty = JSON.stringify(cur) !== JSON.stringify(settings);

  const update = useCallback(
    (fn: (prev: Settings) => Settings) => {
      onDraftChange?.(fn(cur));
    },
    [cur, onDraftChange],
  );

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => update((d) => ({ ...d, [key]: value }));
  const setBrief = (key: BriefKey, value: string) => update((d) => ({ ...d, brief: { ...d.brief, [key]: value } }));
  const setDomains = (bucket: SourceBucket, list: string[]) =>
    update((d) => ({ ...d, sourceDomains: { ...d.sourceDomains, [bucket]: list } }));

  /* ---------- что изменено относительно сохранённого ---------- */

  const changed = useMemo(() => {
    const list: { id: string; label: string; group: GroupId }[] = [];
    if (cur.model !== settings.model) list.push({ id: "model", label: "Модель", group: "connection" });
    if (cur.maxSearches !== settings.maxSearches) list.push({ id: "maxSearches", label: "Поисков на ресерч", group: "connection" });
    if (cur.maxFetches !== settings.maxFetches) list.push({ id: "maxFetches", label: "Страниц на проверку", group: "connection" });
    if (cur.userLocation.city !== settings.userLocation.city) list.push({ id: "city", label: "Город", group: "connection" });
    if (cur.userLocation.timezone !== settings.userLocation.timezone)
      list.push({ id: "timezone", label: "Часовой пояс", group: "connection" });
    cur.brief.rubrics.forEach((r, i) => {
      if (r !== settings.brief.rubrics[i]) list.push({ id: `rubric-${i}`, label: `Рубрика: ${WEEKDAYS_RU[(i + 1) % 7]}`, group: "rubrics" });
    });
    for (const f of FIELDS) {
      if (cur.brief[f.key] !== settings.brief[f.key]) list.push({ id: `brief-${f.key}`, label: f.label, group: f.group });
    }
    for (const b of BUCKETS) {
      if (cur.sourceDomains[b].join(",") !== settings.sourceDomains[b].join(","))
        list.push({ id: `domains-${b}`, label: `Домены: ${BUCKET_LABEL[b]}`, group: "where" });
    }
    return list;
  }, [cur, settings]);

  const changedGroups = useMemo(() => new Set(changed.map((c) => c.group)), [changed]);

  /** id элемента → текст ошибки; на одно поле показываем первую. */
  const issueById = useMemo(() => {
    const map = new Map<string, string>();
    for (const issue of issues) {
      const target = targetOf(issue.path);
      if (target && !map.has(target.id)) map.set(target.id, issue.message);
    }
    return map;
  }, [issues]);

  /* ---------- оглавление: подсветка по скроллу ---------- */

  useEffect(() => {
    const els = GROUPS.map((g) => document.getElementById(`brief-group-${g.id}`)).filter(
      (el): el is HTMLElement => el !== null,
    );
    if (els.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActive(top.target.id.replace("brief-group-", "") as GroupId);
      },
      { rootMargin: "-96px 0px -60% 0px", threshold: 0 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  const goTo = useCallback(
    (id: string, group?: GroupId) => {
      if (group) setActive(group);
      const el = document.getElementById(id);
      el?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
      if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) el.focus({ preventScroll: true });
    },
    [reduce],
  );

  /* ---------- сохранение и проверка подключения ---------- */

  async function save() {
    setSaving(true);
    setSaveError(null);
    setIssues([]);
    try {
      await onSave(cur);
      toast("Бриф сохранён");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Не удалось сохранить";
      setSaveError(message);
      toast(message, "warn");
      const list = issuesOf(e);
      setIssues(list);
      const first = list.map((i) => targetOf(i.path)).find((t): t is IssueTarget => t !== null);
      if (first) {
        if (first.bucket) setDomainTab(first.bucket);
        goTo(first.id, first.group);
      }
    } finally {
      setSaving(false);
    }
  }

  async function check() {
    setChecking(true);
    setHealth(null);
    try {
      const res = await fetch("/api/health");
      const json = (await res.json()) as { ok: boolean; message: string };
      setHealth(json);
    } catch (e) {
      setHealth({ ok: false, message: e instanceof Error ? e.message : "Сервер не ответил" });
    } finally {
      setChecking(false);
    }
  }

  /* ---------- часовой пояс ---------- */

  const timezones = useMemo(() => {
    const list = timezoneList();
    return list.includes(cur.userLocation.timezone) ? list : [cur.userLocation.timezone, ...list];
  }, [cur.userLocation.timezone]);

  const tzHint = useMemo(() => {
    let iso: string;
    try {
      iso = todayIso(cur.userLocation.timezone);
    } catch {
      return "Такого пояса нет — дата выпуска посчитаться не сможет.";
    }
    const i = rubricIndex(iso);
    const day = WEEKDAYS_RU[(i + 1) % 7].toLowerCase();
    const rubric = (cur.brief.rubrics[i] ?? "").trim();
    const short = rubric.length > 90 ? `${rubric.slice(0, 90)}…` : rubric;
    return `По этому поясу сейчас ${formatDateRu(iso)}, ${day} → рубрика: ${short || "не задана"}`;
  }, [cur.userLocation.timezone, cur.brief.rubrics]);

  /* ---------- стили полей ---------- */

  const fieldCls =
    "h-11 w-full rounded-none border-0 border-b border-line bg-transparent pb-px text-[12px] text-fg outline-none transition-colors placeholder:text-faint focus:border-b-2 focus:border-accent focus:pb-0 disabled:opacity-60";
  const areaCls =
    "w-full resize-y rounded-[4px] border border-line bg-surface-2 px-3.5 py-3 text-[13px] leading-[1.6] text-fg outline-none transition-colors placeholder:text-faint focus:border-b-2 focus:border-b-accent disabled:opacity-60";

  function numValue(key: "maxSearches" | "maxFetches") {
    return numRaw[key] ?? String(cur[key]);
  }

  function numChange(key: "maxSearches" | "maxFetches", raw: string, min: number, max: number) {
    setNumRaw((p) => ({ ...p, [key]: raw }));
    const n = Number(raw);
    // Number('') === 0 роняет Zod (minSearches ≥ 3), поэтому на пустой строке держим прежнее значение.
    if (raw.trim() === "" || !Number.isFinite(n)) return;
    set(key, Math.min(max, Math.max(min, Math.round(n))));
  }

  function numBlur(key: "maxSearches" | "maxFetches") {
    setNumRaw((p) => {
      const next = { ...p };
      delete next[key];
      return next;
    });
  }

  function numInvalid(key: "maxSearches" | "maxFetches") {
    const raw = numRaw[key];
    return raw !== undefined && raw.trim() !== String(cur[key]);
  }

  /* ---------- карточка поля брифа ---------- */

  function renderField(f: (typeof FIELDS)[number]) {
    const critical = f.key === "verification";
    const isChanged = cur.brief[f.key] !== settings.brief[f.key];
    const bucket = f.bucket;
    const issue = issueById.get(`brief-${f.key}`);
    const errorId = `brief-${f.key}-error`;
    return (
      <FadeUp
        key={f.key}
        className={cn(
          "flex max-w-[80ch] flex-col gap-2.5",
          // Поле с ошибкой сервера поднимается до карточки, чтобы рамка --bad была видна.
          critical || issue ? "card p-5" : "rule pt-5",
          critical && "border-accent border-l-2 border-l-accent",
          issue && "border-bad border-l-2 border-l-bad",
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <label htmlFor={`brief-${f.key}`} className="flex min-w-0 flex-col gap-1">
            <span className="flex items-center gap-2 text-[13px] font-semibold">
              {critical && <ShieldCheck size={16} className="shrink-0 text-accent" aria-hidden />}
              {f.label}
            </span>
            <span className="t-caption">{f.hint}</span>
          </label>
          {isChanged && (
            <div className="flex shrink-0 items-center gap-2">
              <Mark tone="accent">Изменено</Mark>
              {!preview && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setBrief(f.key, settings.brief[f.key])}
                  aria-label={`Вернуть как было: ${f.label}`}
                  title="Вернуть как было"
                >
                  <RotateCcw size={14} aria-hidden />
                  <span className="sr-only sm:not-sr-only">Вернуть</span>
                </Button>
              )}
            </div>
          )}
        </div>

        {critical && (
          <p className="t-body-sm text-fg-soft">
            От этого поля зависит, какие факты попадут в выпуск. Ослабите правила — исчезнет защита от выдуманных цифр.
          </p>
        )}

        <textarea
          id={`brief-${f.key}`}
          rows={f.rows ?? 5}
          className={cn(
            areaCls,
            "min-h-[120px]",
            critical && "font-mono text-[11.5px]",
            issue && "border-bad focus:border-b-bad",
          )}
          value={cur.brief[f.key]}
          disabled={preview}
          aria-invalid={issue ? true : undefined}
          aria-describedby={issue ? errorId : undefined}
          onChange={(e) => setBrief(f.key, e.target.value)}
        />

        {issue && <FieldError id={errorId} text={issue} />}

        <div className="flex flex-wrap items-center justify-between gap-2">
          {bucket ? (
            <p className="t-body-sm text-muted">
              Проза отсюда управляет формулировками запросов. Сам поиск ограничен списком доменов —{" "}
              <button type="button" className="link" onClick={() => { setDomainTab(bucket); goTo("brief-domains", "where"); }}>
                {cur.sourceDomains[bucket].length} {domainsWord(cur.sourceDomains[bucket].length)} в блоке «{BUCKET_LABEL[bucket]}»
              </button>
              .
            </p>
          ) : (
            <span />
          )}
          <span className="t-micro shrink-0">{cur.brief[f.key].length} зн.</span>
        </div>
      </FadeUp>
    );
  }

  const groupFields = (group: GroupId) => FIELDS.filter((f) => f.group === group);

  /* ---------- домены ---------- */

  const modelIssue = issueById.get("model");
  const searchesIssue = issueById.get("maxSearches");
  const fetchesIssue = issueById.get("maxFetches");
  const tzIssue = issueById.get("timezone");
  const cityIssue = issueById.get("city");
  const domainsIssue = issueById.get("brief-domains");

  const tabDefaults = [...DEFAULT_SOURCE_DOMAINS[domainTab]] as string[];
  const tabCurrent = cur.sourceDomains[domainTab];
  const addedVsDefault = tabCurrent.filter((d) => !tabDefaults.includes(d)).length;
  const removedVsDefault = tabDefaults.filter((d) => !tabCurrent.includes(d)).length;

  return (
    <div className="flex flex-col gap-6">
      {preview && (
        <div className="mark flex max-w-[80ch] items-start gap-2.5 border-l-2 border-warn py-1 text-[11.5px] leading-relaxed text-fg">
          <TriangleAlert size={16} className="mt-0.5 shrink-0 text-warn" aria-hidden />
          <span>
            В превью бриф только для чтения. В локальной версии он редактируется здесь и сохраняется в{" "}
            <span className="font-mono text-[11px]">data/settings.json</span>.
          </span>
        </div>
      )}

      <div className="flex flex-col gap-6 min-[1100px]:grid min-[1100px]:grid-cols-[220px_minmax(0,80ch)] min-[1100px]:items-start min-[1100px]:gap-x-12">
        {/* Оглавление: рельс на десктопе */}
        <nav
          aria-label="Разделы брифа"
          className="sticky top-24 hidden min-[1100px]:block"
        >
          <div className="t-label mb-3">Разделы</div>
          <ul className="flex flex-col">
            {GROUPS.map((g) => {
              const on = active === g.id;
              return (
                <li key={g.id} className="relative">
                  <button
                    type="button"
                    onClick={() => goTo(`brief-group-${g.id}`, g.id)}
                    aria-current={on ? "true" : undefined}
                    className={cn(
                      "relative flex w-full items-center gap-2 py-2 pl-3.5 text-left font-mono text-[10.5px] tracking-[0.08em] uppercase transition-colors",
                      on ? "text-fg" : "text-muted hover:text-fg",
                    )}
                  >
                    {on && (
                      <motion.span
                        layoutId="brief-toc-rule"
                        initial={false}
                        transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 38, mass: 0.6 }}
                        className="absolute top-1 bottom-1 left-0 w-0.5 bg-accent"
                      />
                    )}
                    <span className="min-w-0 flex-1">{g.label}</span>
                    {g.core && <span className="t-micro text-ok">ядро</span>}
                    {changedGroups.has(g.id) && (
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                        aria-label="есть несохранённые правки"
                      />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="flex min-w-0 flex-col gap-10">
          {/* Оглавление: полоса на мобильном */}
          <div className="scroll-x sticky top-16 z-20 -mx-4 bg-bg/95 px-4 py-2 backdrop-blur min-[1100px]:hidden">
            <Segmented<GroupId>
              value={active}
              onChange={(v) => goTo(`brief-group-${v}`, v)}
              layoutId="brief-toc-tabs"
              options={GROUPS.map((g) => ({ value: g.id, label: g.label }))}
            />
          </div>

          {/* ---------- ПОДКЛЮЧЕНИЕ ---------- */}
          <Section
            id="brief-group-connection"
            className="scroll-mt-28"
            eyebrow="Подключение"
            title="Модель и лимиты"
            description="Ключ лежит в .env.local и в интерфейсе не показывается. Модель можно сменить без перезапуска."
            actions={
              !preview && (
                <Button size="sm" onClick={check} disabled={checking}>
                  {checking ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <ShieldCheck size={14} aria-hidden />}
                  Проверить подключение
                </Button>
              )
            }
          >
            <div className="grid grid-cols-1 gap-x-8 gap-y-5 @min-[900px]:grid-cols-2">
              <label className="flex flex-col gap-1.5 @min-[900px]:col-span-2">
                <span className="t-label">Модель</span>
                <input
                  id="model"
                  list="model-options"
                  className={cn(fieldCls, "font-mono text-[11.5px]", modelIssue && "border-bad focus:border-bad")}
                  value={cur.model}
                  disabled={preview}
                  aria-invalid={modelIssue ? true : undefined}
                  aria-describedby={modelIssue ? "model-error" : undefined}
                  onChange={(e) => set("model", e.target.value)}
                />
                <datalist id="model-options">
                  {MODELS.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
                {modelIssue && <FieldError id="model-error" text={modelIssue} />}
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="t-label">Поисков на ресерч</span>
                <input
                  id="maxSearches"
                  type="number"
                  min={3}
                  max={40}
                  inputMode="numeric"
                  className={cn(
                    fieldCls,
                    "tabular font-mono",
                    numInvalid("maxSearches") && "border-warn focus:border-warn",
                    searchesIssue && "border-bad focus:border-bad",
                  )}
                  value={numValue("maxSearches")}
                  disabled={preview}
                  aria-invalid={searchesIssue ? true : undefined}
                  aria-describedby={searchesIssue ? "maxSearches-error" : undefined}
                  onChange={(e) => numChange("maxSearches", e.target.value, 3, 40)}
                  onBlur={() => numBlur("maxSearches")}
                />
                <span className={cn("t-body-sm", numInvalid("maxSearches") ? "text-warn" : "text-muted")}>
                  {numInvalid("maxSearches") ? `Допустимо 3–40, сохраним ${cur.maxSearches}` : "От 3 до 40"}
                </span>
                {searchesIssue && <FieldError id="maxSearches-error" text={searchesIssue} />}
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="t-label">Страниц на проверку</span>
                <input
                  id="maxFetches"
                  type="number"
                  min={0}
                  max={30}
                  inputMode="numeric"
                  className={cn(
                    fieldCls,
                    "tabular font-mono",
                    numInvalid("maxFetches") && "border-warn focus:border-warn",
                    fetchesIssue && "border-bad focus:border-bad",
                  )}
                  value={numValue("maxFetches")}
                  disabled={preview}
                  aria-invalid={fetchesIssue ? true : undefined}
                  aria-describedby={fetchesIssue ? "maxFetches-error" : undefined}
                  onChange={(e) => numChange("maxFetches", e.target.value, 0, 30)}
                  onBlur={() => numBlur("maxFetches")}
                />
                <span className={cn("t-body-sm", numInvalid("maxFetches") ? "text-warn" : "text-muted")}>
                  {numInvalid("maxFetches") ? `Допустимо 0–30, сохраним ${cur.maxFetches}` : "От 0 до 30"}
                </span>
                {fetchesIssue && <FieldError id="maxFetches-error" text={fetchesIssue} />}
              </label>

              <label className="flex flex-col gap-1.5 @min-[900px]:col-span-2">
                <span className="t-label">Часовой пояс</span>
                <select
                  id="timezone"
                  className={cn(fieldCls, "font-mono text-[11.5px]", tzIssue && "border-bad focus:border-bad")}
                  value={cur.userLocation.timezone}
                  disabled={preview}
                  aria-invalid={tzIssue ? true : undefined}
                  aria-describedby={tzIssue ? "timezone-error" : undefined}
                  onChange={(e) => set("userLocation", { ...cur.userLocation, timezone: e.target.value })}
                >
                  {timezones.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                </select>
                <span className="t-body-sm text-muted">
                  Пояс задаёт дату выпуска и рубрику дня. {tzHint}
                </span>
                {tzIssue && <FieldError id="timezone-error" text={tzIssue} />}
              </label>

              <label className="flex flex-col gap-1.5 @min-[900px]:col-span-2">
                <span className="t-label">Город для поиска</span>
                <input
                  id="city"
                  className={cn(fieldCls, cityIssue && "border-bad focus:border-bad")}
                  value={cur.userLocation.city}
                  disabled={preview}
                  aria-invalid={cityIssue ? true : undefined}
                  aria-describedby={cityIssue ? "city-error" : undefined}
                  onChange={(e) => set("userLocation", { ...cur.userLocation, city: e.target.value })}
                />
                <span className="t-body-sm text-muted">
                  Пока не сужает поиск: влияет только на формулировки промпта. Дату выпуска определяет пояс выше.
                </span>
                {cityIssue && <FieldError id="city-error" text={cityIssue} />}
              </label>
            </div>

            {health && (
              <motion.div
                initial={reduce ? false : { opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn(
                  "mark flex items-start gap-2.5 border-l-2 py-1 text-[11.5px]",
                  health.ok ? "border-ok" : "border-bad",
                )}
                role="status"
              >
                {health.ok ? (
                  <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-ok" aria-hidden />
                ) : (
                  <TriangleAlert size={16} className="mt-0.5 shrink-0 text-bad" aria-hidden />
                )}
                <span>{health.message}</span>
              </motion.div>
            )}
          </Section>

          {/* ---------- РУБРИКИ ---------- */}
          <Section
            id="brief-group-rubrics"
            className="scroll-mt-28"
            eyebrow="Рубрики"
            title="Угол на каждый день недели"
            description="Рубрика задаёт угол; инфоповод всё равно должен быть свежим."
          >
            <Stagger className="flex flex-col">
              {cur.brief.rubrics.map((r, i) => {
                const issue = issueById.get(`rubric-${i}`);
                return (
                  <FadeUp
                    key={i}
                    className="rule grid grid-cols-1 gap-2 py-4 @min-[620px]:grid-cols-[140px_minmax(0,1fr)] @min-[620px]:gap-4"
                  >
                    <label htmlFor={`rubric-${i}`} className="t-label sm:pt-3">
                      {WEEKDAYS_RU[(i + 1) % 7]}
                    </label>
                    <div className="flex min-w-0 flex-col gap-1.5">
                      <textarea
                        id={`rubric-${i}`}
                        rows={3}
                        className={cn(areaCls, issue && "border-bad focus:border-b-bad")}
                        value={r}
                        disabled={preview}
                        aria-invalid={issue ? true : undefined}
                        aria-describedby={issue ? `rubric-${i}-error` : undefined}
                        onChange={(e) => {
                          const rubrics = [...cur.brief.rubrics];
                          rubrics[i] = e.target.value;
                          update((d) => ({ ...d, brief: { ...d.brief, rubrics } }));
                        }}
                      />
                      {issue && <FieldError id={`rubric-${i}-error`} text={issue} />}
                    </div>
                  </FadeUp>
                );
              })}
            </Stagger>
          </Section>

          {/* ---------- КТО И О ЧЁМ ---------- */}
          <Section
            id="brief-group-who"
            className="scroll-mt-28"
            eyebrow="Бриф"
            title="Кто и о чём"
            description="Это и есть промпт ассистента. Его же можно перенести в n8n или любой другой агент."
          >
            <Stagger className="flex flex-col gap-1">{groupFields("who").map(renderField)}</Stagger>
          </Section>

          {/* ---------- ГДЕ ИСКАТЬ ---------- */}
          <Section
            id="brief-group-where"
            className="scroll-mt-28"
            eyebrow="Бриф"
            title="Где искать"
            description="Текст задаёт темы и формулировки запросов, список доменов — границы поиска."
          >
            <Stagger className="flex flex-col gap-1">{groupFields("where").map(renderField)}</Stagger>

            <div
              id="brief-domains"
              className={cn(
                "card mt-4 flex max-w-[80ch] scroll-mt-28 flex-col gap-4 p-5",
                domainsIssue && "border-bad border-l-2 border-l-bad",
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="t-label">Разрешённые домены</div>
                  <p className="t-body-sm mt-1 max-w-[62ch] text-muted">
                    Это и есть настоящий фильтр: поиск идёт строго по этим адресам, всё остальное отбрасывается.
                  </p>
                  {/* Без этой оговорки владелец правит списки и не понимает,
                      почему в главном разделе ничего не меняется. */}
                  <p className="t-body-sm mt-2 max-w-[62ch] text-faint">
                    Действует в разделе <b className="text-muted">«Выпуск»</b>. Раздел{" "}
                    <b className="text-muted">«Сегодня»</b> ищет по всему вебу — иначе тем на каждый день не
                    набирается, — но каждую найденную страницу проверяет на понятия вашей ниши по тексту.
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {(addedVsDefault > 0 || removedVsDefault > 0) && (
                    <Mark tone="accent">
                      {`+${addedVsDefault} / −${removedVsDefault} к дефолту`}
                    </Mark>
                  )}
                  {!preview && (
                    <Button
                      size="sm"
                      onClick={() => setDomains(domainTab, tabDefaults)}
                      disabled={addedVsDefault === 0 && removedVsDefault === 0}
                    >
                      <RotateCcw size={14} aria-hidden />
                      Вернуть список по умолчанию
                    </Button>
                  )}
                </div>
              </div>

              <Segmented<SourceBucket>
                value={domainTab}
                onChange={setDomainTab}
                layoutId="brief-domain-tabs"
                options={BUCKETS.map((b) => ({
                  value: b,
                  label: BUCKET_LABEL[b],
                  hint: String(cur.sourceDomains[b].length),
                }))}
              />

              <DomainEditor
                value={cur.sourceDomains[domainTab]}
                onChange={(v) => setDomains(domainTab, v)}
                disabled={preview}
                label={BUCKET_LABEL[domainTab]}
              />

              {domainsIssue && <FieldError id="brief-domains-error" text={domainsIssue} />}

              <p className="t-body-sm rule pt-3 text-muted">
                Формулировки для этого блока живут в поле{" "}
                <button
                  type="button"
                  className="link"
                  onClick={() => goTo(`brief-${BUCKET_FIELD[domainTab]}`, "where")}
                >
                  «{FIELDS.find((f) => f.key === BUCKET_FIELD[domainTab])?.label}»
                </button>
                . Текст подсказывает, что искать; список выше решает, где.
              </p>
            </div>
          </Section>

          {/* ---------- ЧТО СЧИТАТЬ ПРАВДОЙ ---------- */}
          <Section
            id="brief-group-truth"
            className="scroll-mt-28"
            eyebrow="Ядро"
            title="Что считать правдой"
            description="Два поля, ради которых всё и затевалось: правила проверки и выбор темы."
          >
            <Stagger className="flex flex-col gap-4">{groupFields("truth").map(renderField)}</Stagger>
          </Section>

          {/* ---------- ФОРМАТЫ ---------- */}
          <Section
            id="brief-group-formats"
            className="scroll-mt-28"
            eyebrow="Бриф"
            title="Форматы"
            description="Как выпуск превращается в сторис, карусель и рилс."
          >
            <Stagger className="flex flex-col gap-1">{groupFields("formats").map(renderField)}</Stagger>
          </Section>

          {/* ---------- СВОДКА И СОХРАНЕНИЕ ---------- */}
          {!preview && changed.length > 0 && (
            <div className="rule flex flex-col gap-2 pt-4" aria-live="polite">
              <span className="t-label">Перед сохранением</span>
              <p className="t-body-sm text-fg-soft">
                Изменено {changed.length} {fieldsWord(changed.length)}:
              </p>
              <ul className="flex flex-wrap gap-1.5">
                {changed.map((c) => (
                  <li key={c.id}>
                    <button type="button" className="link t-body-sm" onClick={() => goTo(c.id, c.group)}>
                      {c.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {preview ? (
            <div className="rule t-label flex items-center gap-2 pt-4 text-muted">
              <Eye size={14} aria-hidden />
              Только чтение
            </div>
          ) : (
            <div className="rule sticky bottom-[var(--inset-b)] z-20 flex flex-wrap items-center justify-between gap-3 bg-bg/95 py-3 backdrop-blur">
              <div className="min-w-0">
                <span className={cn("t-label", dirty ? "text-accent" : "text-muted")}>
                  {dirty ? `Изменено: ${changed.length} ${fieldsWord(changed.length)}` : "Изменений нет"}
                </span>
                {saveError && (
                  <p role="alert" className="t-body-sm mt-1 max-w-[52ch] text-bad">
                    {saveError}
                  </p>
                )}
              </div>
              <Button variant="primary" size="lg" onClick={save} disabled={!dirty || saving}>
                {saving ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Save size={16} aria-hidden />}
                {dirty ? "Сохранить бриф" : "Изменений нет"}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
