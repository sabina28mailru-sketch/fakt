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
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { useCallback, useState } from "react";
import type { DailyFeed, FeedGap, FeedKind, FeedTopic } from "@/lib/schema";
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
      className={cn("group flex w-full items-center gap-2 text-left", className)}
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
              <span className="t-kicker">{name}</span>
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

function StoriesBody({ topic }: { topic: FeedTopic }) {
  return (
    <ol className="flex flex-col gap-3">
      {topic.stories.frames.map((f) => (
        <li key={f.n} className="flex gap-3">
          <span className="t-meta w-6 shrink-0 pt-0.5 text-faint">{String(f.n).padStart(2, "0")}</span>
          <div className="min-w-0 flex-1">
            <p className="t-content font-semibold! [text-wrap:pretty]">{f.text}</p>
            <p className="t-caption mt-1.5">
              <span className="t-kicker">На экране</span> {f.visual}
            </p>
            {f.interactive && (
              <p className="t-caption mt-1 text-accent">
                <span className="t-kicker">Интерактив</span> {f.interactive}
              </p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

function CarouselBody({ topic }: { topic: FeedTopic }) {
  return (
    <>
      <ol className="flex flex-col gap-3">
        {topic.carousel.slides.map((s) => (
          <li key={s.n} className="flex gap-3">
            <span className="t-meta w-6 shrink-0 pt-0.5 text-faint">{String(s.n).padStart(2, "0")}</span>
            <div className="min-w-0 flex-1">
              <p className="t-d3">{s.title}</p>
              <p className="t-content mt-1 [text-wrap:pretty]">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="rule mt-4 pt-3">
        <span className="t-kicker">Подпись к посту</span>
        <p className="t-content mt-1.5 [text-wrap:pretty]">{topic.carousel.caption}</p>
      </div>
    </>
  );
}

function ReelBody({ topic }: { topic: FeedTopic }) {
  return (
    <>
      <div className="mark border-l-2 border-accent pl-3">
        <span className="t-kicker">Хук · первые 3 секунды</span>
        <p className="t-hook mt-1.5 [text-wrap:pretty]">{topic.reel.hook}</p>
      </div>
      <ol className="mt-4 flex flex-col gap-2">
        {topic.reel.script.map((l, i) => (
          <li key={i} className="flex gap-3">
            <span className="t-log w-[74px] shrink-0 pt-0.5 text-faint">{l.time}</span>
            <p className="t-content min-w-0 flex-1 [text-wrap:pretty]">{l.text}</p>
          </li>
        ))}
      </ol>
      {topic.reel.captions.length > 0 && (
        <p className="t-caption mt-3">
          <span className="t-kicker">Надписи на экране</span> {topic.reel.captions.join(" · ")}
        </p>
      )}
      <div className="rule mt-4 pt-3">
        <span className="t-kicker">Призыв</span>
        <p className="t-content mt-1.5">{topic.reel.cta}</p>
        <span className="t-kicker mt-3 block">Подпись к рилсу</span>
        <p className="t-content mt-1.5 [text-wrap:pretty]">{topic.reel.caption}</p>
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
          <span className="t-kicker">Основание</span>
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
            <blockquote className="border-l-2 border-line-strong pl-3">
              <span className="t-kicker">Подтверждение со страницы</span>
              <p className="t-content mt-1.5 text-fg-soft italic [text-wrap:pretty]">«{topic.evidence}»</p>
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
              <span className="t-kicker">Факты</span>
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
            <span className="t-kicker">Источники</span>
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
              <span className="t-kicker">Названы на странице</span>
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
            <span className="t-kicker">Из чего сложился балл</span>
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

function TopicCard({ topic, index }: { topic: FeedTopic; index: number }) {
  const Icon = KIND_ICON[topic.kind];
  return (
    <FadeUp as="article" className="card flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <span className="flex items-center gap-2.5">
          <span className="t-meta text-faint">Тема {String(index + 1).padStart(2, "0")}</span>
          <Icon size={13} className="shrink-0 text-muted" aria-hidden />
          <Mark tone={KIND_TONE[topic.kind]}>{FEED_KIND_LABEL[topic.kind]}</Mark>
        </span>
        <CopyButton
          text={feedTopicToText(topic)}
          label="Копировать тему целиком"
          variant="ghost"
          size="sm"
        />
      </div>

      <div>
        <h3 className="t-d3 [text-wrap:balance]">{topic.title}</h3>
        <p className="t-content mt-2 text-fg-soft [text-wrap:pretty]">{topic.angle}</p>
      </div>

      {/* Непроверенное — наверху карточки, а не в свёрнутом блоке внизу.
          Владелец копирует текст сразу; предупреждение, которое надо искать,
          бесполезно. */}
      {topic.unverified.length > 0 && (
        <div role="alert" className="mark border-l-2 border-bad bg-bad-soft px-3 py-2.5">
          <Mark tone="bad">Проверьте перед публикацией</Mark>
          <ul className="mt-2 flex flex-col gap-1">
            {topic.unverified.map((u, i) => (
              <li key={i} className="t-body-sm text-fg [text-wrap:pretty]">
                {u}
              </li>
            ))}
          </ul>
          <p className="t-micro mt-2 text-muted">
            Это то, чего нет на скачанных страницах. Остальные цифры в теме сверены с источниками.
          </p>
        </div>
      )}

      <p className="t-body-sm text-muted [text-wrap:pretty]">
        <span className="t-kicker">Почему сейчас</span> {topic.whyNow}
      </p>

      {topic.audienceQuestion && (
        <p className="t-body-sm text-muted [text-wrap:pretty]">
          <span className="t-kicker">Вопрос аудитории</span> {topic.audienceQuestion}
        </p>
      )}

      <div className="mt-1 flex flex-col">
        <FormatBlock
          icon={Camera}
          name="Сторис"
          idea={topic.stories.idea}
          copyAll={feedStoriesToText(topic)}
          copyTexts={feedStoriesTextsOnly(topic)}
          copyLabel="сторис"
        >
          <StoriesBody topic={topic} />
        </FormatBlock>

        <FormatBlock
          icon={GalleryHorizontalEnd}
          name="Карусель"
          idea={topic.carousel.idea}
          copyAll={feedCarouselToText(topic)}
          copyTexts={feedCarouselTextsOnly(topic)}
          copyLabel="карусель"
        >
          <CarouselBody topic={topic} />
        </FormatBlock>

        <FormatBlock
          icon={Film}
          name="Рилс"
          idea={topic.reel.idea}
          copyAll={feedReelToText(topic)}
          copyTexts={feedReelTextsOnly(topic)}
          copyLabel="рилс"
        >
          <ReelBody topic={topic} />
        </FormatBlock>

        <GroundBlock topic={topic} />
      </div>
    </FadeUp>
  );
}

export function TodayView({
  feed,
  date,
  running,
  preview,
  onGenerate,
}: {
  feed?: DailyFeed;
  /** Сегодняшняя дата по часовому поясу пользователя. */
  date: string;
  running: boolean;
  preview: boolean;
  /** kinds задаётся при доборе одного пустого типа. Пусто — собрать всё. */
  onGenerate: (kinds?: FeedKind[]) => void;
}) {
  const [confirmRedo, setConfirmRedo] = useState(false);
  const stale = Boolean(feed) && feed?.date !== date;

  const redo = useCallback(() => {
    setConfirmRedo(false);
    onGenerate();
  }, [onGenerate]);

  if (!feed || !feed.topics.length) {
    return (
      <div className="flex flex-col items-center gap-4 py-20 text-center">
        <Sparkles size={30} className="text-muted" aria-hidden />
        <span className="t-kicker">{formatDateRu(date)}</span>
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
    );
  }

  return (
    <div className="flex flex-col gap-6 pb-4">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <div className="t-kicker mb-2">Лента дня</div>
          <h1 className="t-d1">{formatDateRu(feed.date)}</h1>
          <p className="t-lead mt-2">
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
          <TopicCard key={topic.id} topic={topic} index={i} />
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
