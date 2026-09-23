"use client";

import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "framer-motion";
import { Newspaper } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  DailyFeed,
  Edition,
  FeedEvent,
  FeedKind,
  FeedScript,
  PipelineEvent,
  ResearchResult,
  Settings,
} from "@/lib/schema";
import { FEED_STEPS, STEPS } from "@/lib/steps";
import { formatTimeRu, todayIso } from "@/lib/utils";
import { BriefView } from "./BriefView";
import { EditionView } from "./EditionView";
import { HistoryView } from "./HistoryView";
import { ResearchView } from "./ResearchView";
import { TodayView } from "./TodayView";
import { EASE, T } from "./motion";
import { Nav, type NavStatus, type View } from "./Nav";
import { PipelinePanel, PipelineSummaryBar, emptyPipeline, type PipelineState } from "./PipelinePanel";
import { TopBar } from "./TopBar";
import { Button } from "./ui/Button";
import { ToastProvider, useToast } from "./ui/Toast";
import { useTheme } from "./useTheme";

export interface AppProps {
  initialEditions: Edition[];
  /** Сохранённые темы исследования и последний результат — из data/research.json. */
  initialTags?: string[];
  initialResearch?: ResearchResult;
  /** Ленты за последние дни, свежие первыми. Сегодняшняя открывается сразу. */
  initialFeeds?: DailyFeed[];
  initialSettings: Settings;
  preview: boolean;
}

/** Одна ошибка валидации настроек с сервера (форма issue из Zod). */
export interface SettingsIssue {
  path: (string | number)[];
  message: string;
}

/** Ошибка сохранения брифа: message — для тоста, issues — чтобы подсветить поля. */
export type SettingsSaveError = Error & { issues?: SettingsIssue[] };

/** Черновик брифа в localStorage: переживает перезагрузку и закрытие вкладки. */
const DRAFT_KEY = "fakt-brief-draft";

/**
 * Черновик прошлой сессии, если он есть и отличается от сохранённых настроек.
 * Совпавший с настройками предлагать нечего — его подчистит автосохранение.
 * Любое обращение к localStorage может бросить (приватное окно), отсюда try/catch.
 */
function readDraftOffer(saved: Settings): { at: number; draft: Settings } | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as { at?: number; draft?: Settings };
    if (!stored.draft || typeof stored.at !== "number") return null;
    if (JSON.stringify(stored.draft) === JSON.stringify(saved)) return null;
    return { at: stored.at, draft: stored.draft };
  } catch {
    return null;
  }
}

export function App(props: AppProps) {
  return (
    <ToastProvider>
      <Shell {...props} />
    </ToastProvider>
  );
}

function Shell({ initialEditions, initialSettings, initialTags, initialResearch, initialFeeds, preview }: AppProps) {
  const [editions, setEditions] = useState<Edition[]>(initialEditions);
  const [settings, setSettings] = useState<Settings>(initialSettings);
  const [currentId, setCurrentId] = useState<string | undefined>(initialEditions[0]?.id);
  const [feeds, setFeeds] = useState<DailyFeed[]>(initialFeeds ?? []);
  /** Какой день ленты открыт. Пусто — сегодняшний. */
  const [feedDate, setFeedDate] = useState<string | undefined>(undefined);
  /** Для какой темы сейчас пишется сценарий. Блокирует повторное нажатие. */
  const [writingKind, setWritingKind] = useState<FeedKind | undefined>(undefined);
  // «Сегодня» — главный экран: день начинается с него, а не с архива выпусков.
  const [view, setView] = useState<View>("today");
  const [pipeline, setPipeline] = useState<PipelineState>(() => emptyPipeline(STEPS));
  /**
   * Какой конвейер показывает панель. Панель одна на оба: у выпуска и у ленты
   * разные шаги, но одинаковое устройство показа, и две похожие панели
   * пришлось бы чинить дважды.
   */
  const [panelKind, setPanelKind] = useState<"edition" | "feed">("edition");
  const [panelOpen, setPanelOpen] = useState(false);
  // Черновик брифа живёт здесь: AnimatePresence размонтирует BriefView при смене раздела,
  // и правки, лежащие в его собственном состоянии, исчезали молча.
  const [briefDraft, setBriefDraft] = useState<Settings>(initialSettings);
  // Черновик прошлой сессии читаем в инициализаторе состояния: на сервере localStorage нет,
  // и там выйдет null, а полоса восстановления рисуется только в разделе «Бриф», которого
  // при гидратации ещё нет, — расхождения разметки не возникает.
  // Пока пользователь не решил судьбу черновика, хранилище не трогаем.
  const [draftOffer, setDraftOffer] = useState(() => readDraftOffer(initialSettings));
  const abortRef = useRef<AbortController | null>(null);
  const { isDark, toggle } = useTheme();
  const toast = useToast();
  const reduce = useReducedMotion();

  const current = useMemo(() => editions.find((e) => e.id === currentId) ?? editions[0], [editions, currentId]);
  const today = todayIso(settings.userLocation.timezone);
  // Открытый день: выбранный вручную либо сегодняшний.
  const shownFeed = useMemo(
    () => feeds.find((f) => f.date === (feedDate ?? today)),
    [feeds, feedDate, today],
  );
  const running = pipeline.status === "running";
  const isToday = current?.date === today;
  const hasToday = useMemo(() => editions.some((e) => e.date === today), [editions, today]);
  const hasFeedToday = useMemo(() => feeds.some((f) => f.date === today), [feeds, today]);
  const briefDirty = useMemo(() => JSON.stringify(briefDraft) !== JSON.stringify(settings), [briefDraft, settings]);

  const navStatus = useMemo<NavStatus | undefined>(() => {
    if (!current) return undefined;
    const by = (c: Edition["facts"][number]["confidence"]) => current.facts.filter((f) => f.confidence === c).length;
    return {
      date: `${current.date.slice(8, 10)}.${current.date.slice(5, 7)}`,
      total: current.facts.length,
      high: by("high"),
      medium: by("medium"),
      low: by("low"),
    };
  }, [current]);

  const apply = useCallback((event: PipelineEvent | FeedEvent) => {
    setPipeline((p) => {
      const next: PipelineState = { ...p, steps: { ...p.steps }, logs: p.logs };
      if (event.type === "step") {
        next.steps[event.step] = { status: event.status, detail: event.detail };
      } else if (event.type === "log") {
        next.logs = [...p.logs, { id: p.logs.length + 1, kind: event.kind, text: event.text, at: Date.now() }];
      } else if (event.type === "error") {
        next.status = "error";
        next.error = event.message;
        next.finishedAt = Date.now();
        for (const k of Object.keys(next.steps) as (keyof typeof next.steps)[]) {
          if (next.steps[k].status === "running") next.steps[k] = { status: "error" };
        }
      } else if (event.type === "done") {
        next.status = "done";
        next.finishedAt = Date.now();
      }
      return next;
    });
  }, []);

  /** Остановка прогона по кнопке: рвём поток и честно помечаем это в панели и логе. */
  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPipeline((p) => {
      if (p.status !== "running") return p;
      const steps = { ...p.steps };
      for (const k of Object.keys(steps) as (keyof typeof steps)[]) {
        if (steps[k].status === "running") steps[k] = { status: "idle" };
      }
      return {
        ...p,
        status: "cancelled",
        finishedAt: Date.now(),
        steps,
        logs: [...p.logs, { id: p.logs.length + 1, kind: "warn", text: "Остановлено пользователем", at: Date.now() }],
      };
    });
  }, []);

  const generate = useCallback(async () => {
    setPanelKind("edition");
    setPanelOpen(true);
    if (preview) return;
    if (running) return;
    setPipeline({ ...emptyPipeline(STEPS), status: "running", startedAt: Date.now() });
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: today }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error(`Сервер ответил ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";
        for (const chunk of chunks) {
          const line = chunk.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          const event = JSON.parse(line.slice(6)) as PipelineEvent;
          apply(event);
          if (event.type === "done") {
            setEditions((prev) => [event.edition, ...prev.filter((e) => e.id !== event.edition.id)]);
            setCurrentId(event.edition.id);
            setView("edition");
            toast("Выпуск готов и сохранён");
          }
        }
      }
      setPipeline((p) =>
        p.status === "running"
          ? { ...p, status: "error", error: "Соединение закрылось до завершения", finishedAt: Date.now() }
          : p,
      );
    } catch (e) {
      // Отмена — не ошибка: статус и строку в логе уже поставил cancel().
      if (e instanceof Error && e.name === "AbortError") return;
      // Ошибка чтения не рвёт HTTP-запрос сама: без abort() серверный генератор
      // продолжит работать и тратить платные вызовы, хотя в панели уже ошибка.
      controller.abort();
      apply({ type: "error", message: e instanceof Error ? e.message : String(e) });
    } finally {
      // Отработавший контроллер не должен оставаться в ref: сравнение защищает от гонки
      // с уже запущенным следующим прогоном.
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [apply, preview, running, today, toast]);

  /**
   * Собрать ленту дня. Отдельный маршрут и свои шаги, но панель та же:
   * прогон длится минутами, и человеку нужно видеть, что происходит.
   * Темы приходят событием "topic" по мере готовности — лента наполняется
   * на глазах, а не появляется целиком в конце.
   */
  const generateFeed = useCallback(async (kinds?: FeedKind[]) => {
    setPanelKind("feed");
    setPanelOpen(true);
    if (preview) return;
    if (running) return;
    setPipeline({ ...emptyPipeline(FEED_STEPS), status: "running", startedAt: Date.now() });
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch("/api/feed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // kinds задаётся при доборе одного пустого типа: тогда сервер ищет
        // только по нему, а готовые темы дня берёт из сохранённой ленты.
        body: JSON.stringify(kinds?.length ? { date: today, kinds } : { date: today }),
        signal: controller.signal,
      });
      if (res.status === 409) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Лента на эту дату уже собирается.");
      }
      if (!res.ok || !res.body) throw new Error(`Сервер ответил ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";
        for (const chunk of chunks) {
          const line = chunk.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          const event = JSON.parse(line.slice(6)) as FeedEvent;
          apply(event);
          if (event.type === "done") {
            // Свежесобранная лента заменяет свою дату в подшивке.
            setFeeds((prev) => [event.feed, ...prev.filter((f) => f.date !== event.feed.date)]);
            setFeedDate(undefined);
            setView("today");
            toast(
              event.feed.shortfall
                ? `Лента собрана: ${event.feed.topics.length} из 3 тем`
                : "Лента на сегодня готова",
            );
          }
        }
      }
      setPipeline((p) =>
        p.status === "running"
          ? { ...p, status: "error", error: "Соединение закрылось до завершения", finishedAt: Date.now() }
          : p,
      );
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      // Без abort() серверный генератор продолжит работать и тратить вызовы
      // моделей, хотя в панели уже стоит ошибка.
      controller.abort();
      apply({ type: "error", message: e instanceof Error ? e.message : String(e) });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [apply, preview, running, today, toast]);

  /**
   * Заказать сценарий для одной темы. Отдельно от сборки ленты: раздел
   * приносит разбор новости, а три формата пишутся для той темы, которую
   * владелец выбрал. Это один вызов модели вместо трёх на каждый прогон.
   */
  const writeScript = useCallback(
    async (kind: FeedKind) => {
      if (preview || writingKind) return;
      setWritingKind(kind);
      try {
        const res = await fetch("/api/feed/script", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date: shownFeed?.date ?? today, kind }),
        });
        const body = (await res.json().catch(() => ({}))) as { script?: FeedScript; error?: string };
        if (!res.ok || !body.script) throw new Error(body.error ?? `Сервер ответил ${res.status}`);
        const script = body.script;
        const date = shownFeed?.date ?? today;
        setFeeds((prev) =>
          prev.map((f) =>
            f.date === date ? { ...f, topics: f.topics.map((t) => (t.kind === kind ? { ...t, script } : t)) } : f,
          ),
        );
        toast(
          script.unverified.length
            ? `Сценарий готов, но ${script.unverified.length} утверждений не подтвердилось`
            : "Сценарий готов",
        );
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e));
      } finally {
        setWritingKind(undefined);
      }
    },
    [preview, shownFeed, today, toast, writingKind],
  );

  const saveSettings = useCallback(async (s: Settings) => {
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(s),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string; issues?: SettingsIssue[] };
      const error: SettingsSaveError = new Error(body.error ?? `Сервер ответил ${res.status}`);
      // Поля, не прошедшие проверку, доезжают до BriefView вместе с ошибкой — иначе он
      // показывает только общую фразу и не может подсветить конкретную карточку.
      if (body.issues?.length) error.issues = body.issues;
      throw error;
    }
    const saved = (await res.json()) as Settings;
    setSettings(saved);
    setBriefDraft(saved);
  }, []);

  // Клавиатура: 1/2/3 — разделы, T — тема, Escape — свернуть конвейер.
  // Сравнение по event.code, чтобы кириллическая раскладка работала так же.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) return;
      }
      // Порядок цифр совпадает с порядком разделов в навигации.
      if (e.code === "Digit1") setView("today");
      else if (e.code === "Digit2") setView("edition");
      else if (e.code === "Digit3") setView("research");
      else if (e.code === "Digit4") setView("history");
      else if (e.code === "Digit5") setView("brief");
      else if (e.code === "KeyT") toggle();
      else if (e.code === "Escape") {
        // Escape закрывает только верхний слой: пока открыт поповер/диалог,
        // панель конвейера не трогаем — её закроет следующее нажатие.
        if (document.querySelector('[role="dialog"]')) return;
        setPanelOpen(false);
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggle]);

  // Несохранённый бриф не должен уезжать вместе с вкладкой.
  useEffect(() => {
    if (!briefDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [briefDirty]);

  // Автосохранение черновика с дебаунсом: 500 мс тишины после последней правки.
  // Когда правок нет (в том числе сразу после успешного сохранения) — запись удаляется.
  useEffect(() => {
    const id = window.setTimeout(() => {
      try {
        if (briefDirty) localStorage.setItem(DRAFT_KEY, JSON.stringify({ at: Date.now(), draft: briefDraft }));
        // Пока висит предложение восстановить, чужую запись не стираем: иначе перезагрузка
        // без ответа на полосу потеряет черновик. Сам черновик уже лежит в draftOffer.
        else if (!draftOffer) localStorage.removeItem(DRAFT_KEY);
      } catch {
        // Хранилище недоступно — черновик просто не переживёт перезагрузку.
      }
    }, 500);
    return () => window.clearTimeout(id);
  }, [briefDraft, briefDirty, draftOffer]);

  const restoreDraft = useCallback(() => {
    if (!draftOffer) return;
    setBriefDraft(draftOffer.draft);
    setDraftOffer(null);
  }, [draftOffer]);

  const discardDraft = useCallback(() => {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      // Нечего удалять — хранилище недоступно.
    }
    setDraftOffer(null);
  }, []);

  return (
    <LayoutGroup>
      <div className="min-h-full lg:grid lg:grid-cols-[var(--rail)_minmax(0,1fr)]">
        <Nav
          view={view}
          onChange={setView}
          briefDirty={briefDirty}
          status={navStatus}
        />
        <div className="flex min-w-0 flex-col">
          <TopBar
            date={today}
            model={settings.model}
            running={running}
            view={view}
            hasFeedToday={hasFeedToday}
            onGenerate={view === "today" ? () => generateFeed() : generate}
            onCancel={cancel}
            isDark={isDark}
            onToggleTheme={toggle}
            preview={preview}
            hasToday={hasToday}
          />

          <AnimatePresence initial={false}>
            {panelOpen && (
              <PipelinePanel
                key="pipeline"
                state={pipeline}
                preview={preview}
                steps={panelKind === "feed" ? FEED_STEPS : STEPS}
                kicker={panelKind === "feed" ? "Лента дня" : "Конвейер"}
                onClose={() => setPanelOpen(false)}
              />
            )}
          </AnimatePresence>

          {/* Панель скрыта, но прогон был: свёрнутая полоса возвращает её без нового запуска. */}
          {!panelOpen && pipeline.status !== "idle" && (
            <PipelineSummaryBar state={pipeline} onOpen={() => setPanelOpen(true)} />
          )}

          <main
            /*
             * Колонка сужена с 1120px. Читаемый текст ограничен мерой в 66
             * знаков (около 560px), и в широком контейнере он занимал левую
             * половину, а справа оставалась пустота. 960 — ширина, при
             * которой карточка и текстовая колонка выглядят одним блоком.
             */
            className="@container mx-auto w-full max-w-[960px] flex-1 px-4 pt-7 pb-4 md:px-7 xl:px-8"
            style={{ paddingBottom: "calc(var(--dock-h) + 80px)" }}
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={view}
                initial={reduce ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={reduce ? undefined : { opacity: 0 }}
                transition={{ duration: T.move, ease: EASE }}
              >
                {view === "today" && (
                  <TodayView
                    feed={shownFeed}
                    feeds={feeds}
                    date={today}
                    onPickDate={setFeedDate}
                    onWriteScript={writeScript}
                    writing={writingKind}
                    running={running}
                    preview={preview}
                    onGenerate={generateFeed}
                  />
                )}
                {view === "edition" &&
                  (current ? (
                    <EditionView edition={current} isToday={isToday} />
                  ) : (
                    <div className="flex flex-col items-center gap-4 py-20 text-center">
                      <Newspaper size={30} className="text-muted" aria-hidden />
                      <span className="t-label">Полоса пуста</span>
                      <h2 className="font-display text-[19px] leading-tight font-semibold">Выпусков пока нет</h2>
                      <p className="t-body-sm max-w-[46ch] text-muted">
                        Нажмите «Сгенерировать выпуск» — ресерч, проверка и три формата.
                      </p>
                      <Button variant="primary" onClick={generate} disabled={running} className="mt-2">
                        Сгенерировать выпуск
                      </Button>
                    </div>
                  ))}
                {view === "research" && (
                  <ResearchView
                    initialTags={initialTags ?? []}
                    initialResult={initialResearch}
                    preview={preview}
                    onContentReady={(edition) => {
                      setEditions((prev) => [edition, ...prev.filter((e) => e.id !== edition.id)]);
                      setCurrentId(edition.id);
                      setView("edition");
                    }}
                  />
                )}
                {view === "history" && (
                  <HistoryView
                    editions={editions}
                    currentId={current?.id}
                    timeZone={settings.userLocation.timezone}
                    onOpen={(id) => {
                      setCurrentId(id);
                      setView("edition");
                      window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
                    }}
                  />
                )}
                {view === "brief" && draftOffer && (
                  <div
                    role="status"
                    className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[4px] border border-line bg-surface-2 px-4 py-3"
                  >
                    <p className="t-body-sm text-fg-soft">
                      Есть несохранённый черновик от{" "}
                      {formatTimeRu(new Date(draftOffer.at).toISOString(), settings.userLocation.timezone)}
                    </p>
                    <div className="flex shrink-0 gap-2">
                      <Button size="sm" variant="secondary" onClick={restoreDraft}>
                        Восстановить
                      </Button>
                      <Button size="sm" variant="ghost" onClick={discardDraft}>
                        Отбросить
                      </Button>
                    </div>
                  </div>
                )}
                {view === "brief" && (
                  <BriefView
                    settings={settings}
                    onSave={saveSettings}
                    preview={preview}
                    draft={briefDraft}
                    onDraftChange={setBriefDraft}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          </main>
        </div>
      </div>
    </LayoutGroup>
  );
}
