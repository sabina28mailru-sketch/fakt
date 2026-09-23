"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Camera,
  ChevronDown,
  ExternalLink,
  Film,
  GalleryHorizontalEnd,
  Layers,
  MessageCircleQuestion,
  Loader2,
  PenLine,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { useCallback, useState } from "react";
import type { DailyFeed, FeedGap, FeedKind, FeedScript, FeedTopic } from "@/lib/schema";
import {
  feedCarouselTextsOnly,
  feedCarouselToText,
  feedReelTextsOnly,
  feedReelToText,
  feedStoriesTextsOnly,
  feedStoriesToText,
  feedTopicToText,
  feedToText,
} from "@/lib/to-text";
import { CONFIDENCE_LABEL, FEED_KIND_LABEL, cn, formatDateRu, hostOf, plural } from "@/lib/utils";
import { EASE, FadeUp, Stagger, T } from "./motion";
import { Mark, type Tone } from "./ui/Badge";
import { Button } from "./ui/Button";
import { CopyButton } from "./ui/CopyButton";

/**
 * Раздел «Сегодня» — лента дня: три темы разных типов, у каждой три
 * направления контента.
 *
 * Правило показа: свёрнутый уровень отвечает на вопрос «о чём это и стоит ли
 * браться», раскрытый — «что именно снимать». Поэтому наверху карточки стоят
 * тип, заголовок, угол и достоверность, а кадры, слайды и сценарий лежат
 * внутри форматов и открываются по клику. Раздел открывают каждый день —
 * вываливать на человека девять структур сразу значит заставлять его
 * пролистывать их мимо.
 */

/** Тон метки по типу темы. Цвет дублируется словом всегда. */
const KIND_TONE: Record<FeedKind, Tone> = {
  trend: "accent",
  expert: "ok",
  opinion: "warn",
};

const KIND_ICON: Record<FeedKind, typeof Sparkles> = {
  trend: Sparkles,
  expert: Layers,
  opinion: MessageCircleQuestion,
};

function scoreTone(score: number): Tone {
  return score >= 80 ? "ok" : score >= 60 ? "warn" : "bad";
}

function Toggle({
  open,
  onToggle,
  children,
  className,
  label,
}: {
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  className?: string;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={label}
      className={cn(
        "group flex w-full items-center gap-2 text-left",
        // На тач-экранах заголовок-переключатель тянется до 44px, как кнопки:
        // палец не попадает в строку высотой в текст.
        "[@media(pointer:coarse)]:min-h-11",
        className,
      )}
    >
      <ChevronDown
        size={14}
        className={cn("shrink-0 text-muted transition-transform duration-150", open && "rotate-180")}
        aria-hidden
      />
      {children}
    </button>
  );
}

/** Содержимое раскрытого блока: при reduce-motion появляется без анимации высоты. */
function Panel({ open, children }: { open: boolean; children: React.ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          initial={reduce ? false : { height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={reduce ? undefined : { height: 0, opacity: 0 }}
          transition={{ duration: T.base, ease: EASE }}
          className="overflow-hidden"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Одно направление контента. Свёрнуто видны название формата и замысел —
 * по ним и выбирают, что снимать сегодня. Структура внутри.
 */
function FormatBlock({
  icon: Icon,
  name,
  idea,
  copyAll,
  copyTexts,
  copyLabel,
  children,
}: {
  icon: typeof Camera;
  name: string;
  idea: string;
  copyAll: string;
  copyTexts: string;
  copyLabel: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rule pt-3">
      <div className="flex items-start gap-2">
        <Toggle
          open={open}
          onToggle={() => setOpen((v) => !v)}
          label={`${name}: ${open ? "свернуть" : "развернуть"}`}
          className="min-w-0 flex-1 items-start"
        >
          <span className="flex min-w-0 flex-col gap-1">
            <span className="flex items-center gap-2">
              <Icon size={13} className="shrink-0 text-muted" aria-hidden />
              <span className="t-label">{name}</span>
            </span>
            <span className="t-body-sm text-fg-soft [text-wrap:pretty]">{idea}</span>
          </span>
        </Toggle>
        <div className="flex shrink-0 items-center gap-1 pt-0.5">
          <CopyButton iconOnly variant="ghost" size="sm" text={copyTexts} label={`Копировать только тексты: ${copyLabel}`} className="w-8 px-0" />
          <CopyButton iconOnly variant="ghost" size="sm" text={copyAll} label={`Копировать с пометками: ${copyLabel}`} className="w-8 px-0" />
        </div>
      </div>
      <Panel open={open}>
        <div className="pt-3 pb-1">{children}</div>
      </Panel>
    </div>
  );
}

function StoriesBody({ script }: { script: FeedScript }) {
  return (
    <ol className="flex flex-col gap-3">
      {script.stories.frames.map((f) => (
        <li key={f.n} className="flex gap-3">
          <span className="t-meta w-6 shrink-0 pt-0.5 text-faint">{String(f.n).padStart(2, "0")}</span>
          <div className="min-w-0 flex-1">
            <p className="t-content font-semibold!">{f.text}</p>
            <p className="t-caption mt-1.5">
              <span className="t-label">На экране</span> {f.visual}
            </p>
            {f.interactive && (
              <p className="t-caption mt-1 text-accent">
                <span className="t-label">Интерактив</span> {f.interactive}
              </p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

function CarouselBody({ script }: { script: FeedScript }) {
  return (
    <>
      <ol className="flex flex-col gap-3">
        {script.carousel.slides.map((s) => (
          <li key={s.n} className="flex gap-3">
            <span className="t-meta w-6 shrink-0 pt-0.5 text-faint">{String(s.n).padStart(2, "0")}</span>
            <div className="min-w-0 flex-1">
              <p className="t-h4">{s.title}</p>
              <p className="t-content mt-1.5">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="rule mt-4 pt-3">
        <span className="t-label">Подпись к посту</span>
        <p className="t-content mt-2">{script.carousel.caption}</p>
      </div>
    </>
  );
}

function ReelBody({ script }: { script: FeedScript }) {
  return (
    <>
      <div className="mark border-l-2 border-accent pl-3">
        <span className="t-label">Хук · первые 3 секунды</span>
        <p className="t-hook mt-1.5 [text-wrap:pretty]">{script.reel.hook}</p>
      </div>
      <ol className="mt-4 flex flex-col gap-2">
        {script.reel.script.map((l, i) => (
          <li key={i} className="flex gap-3">
            <span className="t-log w-[74px] shrink-0 pt-0.5 text-faint">{l.time}</span>
            <p className="t-content min-w-0 flex-1 [text-wrap:pretty]">{l.text}</p>
          </li>
        ))}
      </ol>
      {script.reel.captions.length > 0 && (
        <p className="t-caption mt-3">
          <span className="t-label">Надписи на экране</span> {script.reel.captions.join(" · ")}
        </p>
      )}
      <div className="rule mt-4 pt-3">
        <span className="t-label">Призыв</span>
        <p className="t-content mt-1.5">{script.reel.cta}</p>
        <span className="t-label mt-3 block">Подпись к рилсу</span>
        <p className="t-content mt-1.5 [text-wrap:pretty]">{script.reel.caption}</p>
      </div>
    </>
  );
}

/** Основание темы: источники, цитата со страницы, факты. Свёрнуто по умолчанию. */
function GroundBlock({ topic }: { topic: FeedTopic }) {
  const [open, setOpen] = useState(false);
  const opened = topic.sources.filter((s) => s.opened).length;
  return (
    <div className="rule pt-3">
      <Toggle
        open={open}
        onToggle={() => setOpen((v) => !v)}
        label={open ? "Свернуть основание темы" : "Развернуть основание темы"}
      >
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
          <span className="t-label">Основание</span>
          <Mark tone={scoreTone(topic.credibility.score)}>{topic.credibility.score}/100</Mark>
          <span className="t-micro text-faint">
            {topic.sources.length} {plural(topic.sources.length, "источник", "источника", "источников")}
            {opened > 0 && `, ${opened} открыт${opened === 1 ? "" : "о"}`}
          </span>
        </span>
      </Toggle>
      <Panel open={open}>
        <div className="flex flex-col gap-4 pt-3 pb-1">
          {topic.evidence && (
            <blockquote className="callout-quiet">
              <span className="t-label">Подтверждение со страницы</span>
              <p className="t-quote mt-2">«{topic.evidence}»</p>
            </blockquote>
          )}

          {topic.facts.length === 0 && (
            <p className="t-body-sm text-warn">
              Проверяемых цифр в этой теме нет. Она стоит на открытом источнике и подтверждённой цитате,
              но числа, которые можно поставить в кадр со ссылкой, на странице не нашлись.
            </p>
          )}

          {topic.facts.length > 0 && (
            <div>
              <span className="t-label">Факты</span>
              <ul className="mt-2 flex flex-col gap-2">
                {topic.facts.map((f, i) => (
                  <li key={i}>
                    <p className="t-body-sm text-fg [text-wrap:pretty]">{f.fact}</p>
                    <p className="t-micro mt-0.5 text-faint">
                      <a className="link" href={f.url} target="_blank" rel="noreferrer noopener">
                        {f.source}
                      </a>
                      {" · "}
                      {f.date} · уверенность: {CONFIDENCE_LABEL[f.confidence].toLowerCase()}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <span className="t-label">Источники</span>
            <ul className="mt-2 flex flex-col gap-1.5">
              {topic.sources.map((s) => (
                <li key={s.url} className="flex items-start gap-2">
                  <ExternalLink size={12} className="mt-1 shrink-0 text-faint" aria-hidden />
                  <span className="min-w-0">
                    <a className="link t-body-sm" href={s.url} target="_blank" rel="noreferrer noopener">
                      {s.title}
                    </a>
                    <span className="t-micro ml-2 text-faint">
                      {hostOf(s.url)}
                      {s.date && ` · ${s.date}`}
                      {s.opened && " · открыт"}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {topic.mentions.length > 0 && (
            <div>
              <span className="t-label">Названы на странице</span>
              <ul className="mt-2 flex flex-col gap-1">
                {topic.mentions.map((m, i) => (
                  <li key={i} className="t-body-sm text-fg-soft">
                    {m}
                  </li>
                ))}
              </ul>
              {/* Ссылок у них нет намеренно: при скачивании страницы адреса
                  вырезаются вместе с разметкой, и любой URL здесь был бы
                  восстановлен моделью по памяти — то есть выдуман. */}
              <p className="t-micro mt-1.5 text-faint">
                Адреса не приводим: на скачанной странице ссылок нет, а подставлять их по памяти нельзя.
              </p>
            </div>
          )}

          <div>
            <span className="t-label">Из чего сложился балл</span>
            <ul className="mt-2 flex flex-col gap-1">
              {topic.credibility.reasons.map((r, i) => (
                <li key={i} className="t-micro text-muted">
                  {r}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Panel>
    </div>
  );
}

/**
 * Пустой тип темы. Показывается на своём месте в ленте, а не прячется в
 * предупреждение наверху: слот должен быть виден, причина — написана рядом,
 * а добрать надо один тип, не трогая две готовые темы.
 *
 * Причину пишет код по своим счётчикам, поэтому она проверяема: «не нашлось
 * страницы, прошедшей проверку» и «кончилась квота» — разные беды.
 */
function GapCard({
  gap,
  running,
  preview,
  onFill,
}: {
  gap: FeedGap;
  running: boolean;
  preview: boolean;
  onFill: () => void;
}) {
  const Icon = KIND_ICON[gap.kind];
  return (
    <FadeUp
      as="article"
      className="card flex flex-col gap-3 border-dashed p-5"
      aria-label={`${FEED_KIND_LABEL[gap.kind]}: тема не собрана`}
    >
      <span className="flex items-center gap-2.5">
        <Icon size={13} className="shrink-0 text-faint" aria-hidden />
        <Mark tone="neutral">{FEED_KIND_LABEL[gap.kind]}</Mark>
        <span className="t-micro text-faint">тема не собрана</span>
      </span>

      <p className="t-body-sm text-fg-soft [text-wrap:pretty]">{gap.reason}</p>

      {gap.retryable && (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" size="sm" onClick={onFill} disabled={running || preview}>
            <RefreshCw size={13} aria-hidden />
            Добрать эту тему
          </Button>
          <span className="t-micro text-faint">
            Поиск пойдёт только по этому типу — готовые темы дня останутся на месте.
          </span>
        </div>
      )}
    </FadeUp>
  );
}

/**
 * Карточка темы дня.
 *
 * Раздел открывают утром, чтобы понять, ЧТО произошло, — поэтому наверху
 * стоит разбор новости, а не готовые кадры. Сценарий пишется по кнопке для
 * той темы, которую выбрали: раньше он писался сразу для всех трёх, и две
 * трети работы и квоты уходили на то, чего никто не заказывал.
 */
function TopicCard({
  topic,
  index,
  busy,
  onWriteScript,
  preview,
}: {
  topic: FeedTopic;
  index: number;
  /** Сценарий этой темы пишется прямо сейчас. */
  busy: boolean;
  onWriteScript: (kind: FeedKind) => void;
  preview: boolean;
}) {
  const Icon = KIND_ICON[topic.kind];
  return (
    <FadeUp as="article" className="card flex flex-col gap-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <span className="flex items-center gap-2.5">
          <span className="t-meta text-faint">Тема {String(index + 1).padStart(2, "0")}</span>
          <Icon size={13} className="shrink-0 text-muted" aria-hidden />
          <Mark tone={KIND_TONE[topic.kind]}>{FEED_KIND_LABEL[topic.kind]}</Mark>
        </span>
        <CopyButton text={feedTopicToText(topic)} label="Копировать тему целиком" variant="ghost" size="sm" />
      </div>

      <h3 className="t-d3">{topic.title}</h3>

      {/* Лид: первый абзац разбора набран серифом и крупнее остального —
          так глаз сразу видит, где начинается текст для чтения. */}
      {topic.summary && <p className="t-lead">{topic.summary}</p>}

      {/* Ключевые детали — не абзацем, а списком с вынесенным маркером:
          структура видна раньше, чем человек начнёт читать. */}
      {topic.details.length > 0 && (
        <div className="rule pt-4">
          <span className="t-label">Детали</span>
          <ul className="points mt-2.5">
            {topic.details.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </div>
      )}

      {topic.soWhat && (
        <div className="callout mt-1">
          <span className="t-label">Что это значит</span>
          <p className="t-read mt-1.5">{topic.soWhat}</p>
        </div>
      )}

      {topic.unverified.length > 0 && (
        <div role="alert" className="border-l-2 border-bad pl-3.5">
          <Mark tone="bad">Проверьте перед публикацией</Mark>
          <ul className="stack-tight mt-2">
            {topic.unverified.map((u, i) => (
              <li key={i} className="t-body-sm text-fg">
                {u}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Служебные пояснения — сеткой «подпись → значение». На широком
          экране подписи стоят колонкой, и глаз бежит по ним вертикально,
          не перечитывая текст рядом. */}
      <dl className="facts-grid rule pt-4">
        <dt className="t-label">Почему сейчас</dt>
        <dd className="t-body-sm text-fg-soft">{topic.whyNow}</dd>

        <dt className="t-label">Угол</dt>
        <dd className="t-body-sm text-fg-soft">{topic.angle}</dd>

        {topic.audienceQuestion && (
          <>
            <dt className="t-label">Вопрос аудитории</dt>
            <dd className="t-body-sm text-fg-soft">{topic.audienceQuestion}</dd>
          </>
        )}
      </dl>

      <div className="mt-1 flex flex-col">
        <GroundBlock topic={topic} />
        <ScriptBlock topic={topic} busy={busy} preview={preview} onWrite={() => onWriteScript(topic.kind)} />
      </div>
    </FadeUp>
  );
}

/**
 * Сценарий темы. Пока не заказан — одна кнопка и честная строка о цене:
 * это вызов модели, а суточная квота не бесконечная.
 */
function ScriptBlock({
  topic,
  busy,
  preview,
  onWrite,
}: {
  topic: FeedTopic;
  busy: boolean;
  preview: boolean;
  onWrite: () => void;
}) {
  const script = topic.script;

  if (!script) {
    return (
      <div className="rule flex flex-wrap items-center gap-3 pt-3">
        <Button variant="secondary" size="sm" onClick={onWrite} disabled={busy || preview}>
          {busy ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <PenLine size={13} aria-hidden />}
          {busy ? "Пишу сценарий…" : "Сгенерировать сценарий"}
        </Button>
        <span className="t-micro text-faint">
          {busy
            ? "Один вызов модели, обычно меньше минуты."
            : "Сторис, карусель и рилс по этой теме — один вызов модели."}
        </span>
      </div>
    );
  }

  return (
    <>
      {script.unverified.length > 0 && (
        <div role="alert" className="mark mt-3 border-l-2 border-bad bg-bad-soft px-3 py-2.5">
          <Mark tone="bad">В сценарии есть неподтверждённое</Mark>
          <ul className="mt-2 flex flex-col gap-1">
            {script.unverified.map((u, i) => (
              <li key={i} className="t-body-sm text-fg [text-wrap:pretty]">
                {u}
              </li>
            ))}
          </ul>
        </div>
      )}

      <FormatBlock
        icon={Camera}
        name="Сторис"
        idea={script.stories.idea}
        copyAll={feedStoriesToText(script)}
        copyTexts={feedStoriesTextsOnly(script)}
        copyLabel="сторис"
      >
        <StoriesBody script={script} />
      </FormatBlock>

      <FormatBlock
        icon={GalleryHorizontalEnd}
        name="Карусель"
        idea={script.carousel.idea}
        copyAll={feedCarouselToText(script)}
        copyTexts={feedCarouselTextsOnly(script)}
        copyLabel="карусель"
      >
        <CarouselBody script={script} />
      </FormatBlock>

      <FormatBlock
        icon={Film}
        name="Рилс"
        idea={script.reel.idea}
        copyAll={feedReelToText(script)}
        copyTexts={feedReelTextsOnly(script)}
        copyLabel="рилс"
      >
        <ReelBody script={script} />
      </FormatBlock>

      <p className="t-micro rule pt-2 text-faint">
        Сценарий написан {script.model || "моделью"}. Кнопка «Сгенерировать» перепишет его заново.
      </p>
    </>
  );
}

/**
 * Подшивка: дни, за которые лента уже собрана. Лежит в самом разделе, а не
 * в «Истории», потому что вчерашние темы ищут именно здесь.
 */
function DayStrip({
  feeds,
  shown,
  today,
  onPick,
}: {
  feeds: DailyFeed[];
  shown?: string;
  today: string;
  onPick: (date?: string) => void;
}) {
  if (feeds.length < 2) return null;
  return (
    <nav className="scroll-x flex gap-1.5 pb-1" aria-label="Дни, за которые собрана лента">
      {feeds.map((f) => {
        const active = f.date === (shown ?? today);
        return (
          <button
            key={f.date}
            type="button"
            onClick={() => onPick(f.date === today ? undefined : f.date)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "shrink-0 rounded-[4px] border px-2.5 py-1.5 text-left transition-colors duration-150",
              "[@media(pointer:coarse)]:min-h-11",
              active ? "border-accent bg-accent-soft text-fg" : "border-line text-muted hover:text-fg",
            )}
          >
            <span className="t-meta block">
              {f.date.slice(8, 10)}.{f.date.slice(5, 7)}
            </span>
            <span className="t-micro block text-faint">
              {f.topics.length} из 3{f.date === today && " · сегодня"}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

export function TodayView({
  feed,
  feeds,
  onPickDate,
  date,
  running,
  preview,
  onGenerate,
  onWriteScript,
  writing,
}: {
  feed?: DailyFeed;
  /** Дни, за которые лента уже собрана, свежие первыми. */
  feeds: DailyFeed[];
  onPickDate: (date?: string) => void;
  /** Сегодняшняя дата по часовому поясу пользователя. */
  date: string;
  running: boolean;
  preview: boolean;
  /** kinds задаётся при доборе одного пустого типа. Пусто — собрать всё. */
  onGenerate: (kinds?: FeedKind[]) => void;
  /** Заказать сценарий для одной темы. */
  onWriteScript: (kind: FeedKind) => void;
  /** Для какой темы сценарий пишется прямо сейчас. */
  writing?: FeedKind;
}) {
  const [confirmRedo, setConfirmRedo] = useState(false);
  const stale = Boolean(feed) && feed?.date !== date;

  const redo = useCallback(() => {
    setConfirmRedo(false);
    onGenerate();
  }, [onGenerate]);

  if (!feed || !feed.topics.length) {
    return (
      <div className="flex flex-col gap-6">
        <DayStrip feeds={feeds} shown={feed?.date} today={date} onPick={onPickDate} />
        <div className="flex flex-col items-center gap-4 py-16 text-center">
        <Sparkles size={30} className="text-muted" aria-hidden />
        <span className="t-label">{formatDateRu(date)}</span>
        <h2 className="font-display text-[19px] leading-tight font-semibold">
          {running ? "Собираю ленту на сегодня" : "Ленты на сегодня ещё нет"}
        </h2>
        <p className="t-body-sm max-w-[52ch] text-muted">
          {running
            ? "Ищу свежие публикации, открываю страницы целиком и проверяю цитаты. Обычно это занимает несколько минут."
            : "Три темы разных типов — тренд, экспертное объяснение и повод для спора, — у каждой сразу сторис, карусель и рилс. Каждая тема стоит на открытом источнике, ни одна не повторяет прошлые дни."}
        </p>
        {!running && (
          <Button variant="primary" onClick={() => onGenerate()} disabled={preview} className="mt-2">
            Собрать ленту на сегодня
          </Button>
        )}
          {preview && <p className="t-micro text-faint">В статичном превью генерация недоступна.</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 pb-4">
      <DayStrip feeds={feeds} shown={feed.date} today={date} onPick={onPickDate} />
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <div className="t-label mb-2">Лента дня</div>
          <h1 className="t-d1">{formatDateRu(feed.date)}</h1>
          <p className="t-deck mt-2">
            {feed.weekday} · {feed.topics.length} {plural(feed.topics.length, "тема", "темы", "тем")} · по три формата
            на каждую
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CopyButton text={feedToText(feed)} label="Копировать всю ленту" variant="secondary" />
          {!confirmRedo ? (
            <Button variant="ghost" size="md" onClick={() => setConfirmRedo(true)} disabled={running || preview}>
              <RefreshCw size={14} aria-hidden />
              Пересобрать
            </Button>
          ) : (
            <span className="flex items-center gap-2">
              <span className="t-caption text-warn">Заменит сегодняшнюю ленту</span>
              <Button variant="danger" size="sm" onClick={redo} disabled={running}>
                Пересобрать
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmRedo(false)}>
                Отмена
              </Button>
            </span>
          )}
        </div>
      </header>

      {stale && (
        <p role="status" className="t-body-sm rounded-[4px] border border-line bg-surface-2 px-4 py-3 text-fg-soft">
          Это лента за {formatDateRu(feed.date)}, а сегодня {formatDateRu(date)}. Нажмите «Собрать ленту», чтобы
          получить сегодняшние темы.
        </p>
      )}

      {feed.shortfall && (
        <p role="status" className="t-body-sm rounded-[4px] border-l-2 border-warn bg-warn-soft px-4 py-3 text-fg">
          {feed.shortfall}
        </p>
      )}

      <Stagger className="flex flex-col gap-4">
        {feed.topics.map((topic, i) => (
          <TopicCard
            key={topic.id}
            topic={topic}
            index={i}
            busy={writing === topic.kind}
            preview={preview}
            onWriteScript={onWriteScript}
          />
        ))}
        {/* Пустые типы — тоже карточки, а не строчка в предупреждении наверху.
            Слот виден на своём месте, причина написана рядом, и добрать можно
            один тип, не пересобирая две готовые темы. */}
        {feed.gaps.map((gap) => (
          <GapCard
            key={gap.kind}
            gap={gap}
            running={running}
            preview={preview}
            onFill={() => onGenerate([gap.kind])}
          />
        ))}
      </Stagger>

      <p className="t-micro text-faint">
        Собрано {feed.meta.searches ?? 0} {plural(feed.meta.searches ?? 0, "поиском", "поисками", "поисками")},{" "}
        {feed.meta.fetches ?? 0} {plural(feed.meta.fetches ?? 0, "страница открыта", "страницы открыто", "страниц открыто")}
        {typeof feed.meta.modelCalls === "number" && ` · вызовов модели: ${feed.meta.modelCalls}`}
      </p>
    </div>
  );
}
