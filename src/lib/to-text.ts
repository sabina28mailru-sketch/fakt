import type { DailyFeed, Edition, FeedScript, FeedTopic } from "./schema";
import { CONFIDENCE_LABEL, FEED_KIND_LABEL, LEVEL_LABEL } from "./utils";

/* ---------- Отдельные фрагменты ----------
   То, что владелец вставляет в Instagram: чистый текст без служебных пометок.
   Массовые варианты ниже (storiesToText и прочие) сохраняют пометки для работы. */

export function frameText(f: Edition["stories"]["frames"][number]) {
  return f.text;
}

export function slideText(s: Edition["carousel"]["slides"][number]) {
  return `${s.title}\n\n${s.body}`;
}

export function reelLineText(l: Edition["reel"]["script"][number]) {
  return l.text;
}

/** Все кадры подряд — только тексты на экране, без «Кадр 3 — селфи-видео». */
export function storiesTextsOnly(e: Edition) {
  return e.stories.frames.map((f) => f.text).join("\n\n");
}

/** Все слайды подряд — заголовок и тело, без «Слайд 4.». */
export function carouselTextsOnly(e: Edition) {
  return e.carousel.slides.map((s) => `${s.title}\n\n${s.body}`).join("\n\n");
}

/** Реплики рилса без тайм-кодов. */
export function reelTextsOnly(e: Edition) {
  return [e.reel.hook, ...e.reel.script.map((l) => l.text), e.reel.cta].join("\n\n");
}

export function storiesToText(e: Edition) {
  return e.stories.frames
    .map((f) => {
      const lines = [`Кадр ${f.n} — ${f.visual}`, f.text];
      if (f.interactive) lines.push(`Интерактив: ${f.interactive}`);
      return lines.join("\n");
    })
    .join("\n\n");
}

export function carouselToText(e: Edition) {
  const slides = e.carousel.slides
    .map((s) => `Слайд ${s.n}. ${s.title}\n${s.body}`)
    .join("\n\n");
  return `${slides}\n\nПодпись к посту:\n${e.carousel.caption}`;
}

export function reelToText(e: Edition) {
  const script = e.reel.script.map((l) => `${l.time} — ${l.text}`).join("\n");
  return [
    `Хук: ${e.reel.hook}`,
    script,
    `Надписи на экране: ${e.reel.captions.join(" · ")}`,
    `Призыв: ${e.reel.cta}`,
    `Подпись к рилсу:\n${e.reel.caption}`,
  ].join("\n\n");
}

export function factsToText(e: Edition) {
  return e.facts
    .map(
      (f, i) =>
        `${i + 1}. ${f.fact}\n   ${f.source} — ${f.url} — ${f.date} — ${LEVEL_LABEL[f.level]} — уверенность: ${CONFIDENCE_LABEL[f.confidence]}${f.note ? ` — ${f.note}` : ""}`,
    )
    .join("\n");
}

export function editionToText(e: Edition) {
  return [
    `ВЫПУСК ${e.date} · ${e.weekday} · ${e.rubric}`,
    `ТЕМА ДНЯ: ${e.topic.title}\n${e.topic.whyNow}`,
    `СТОРИС\n${storiesToText(e)}`,
    `КАРУСЕЛЬ\n${carouselToText(e)}`,
    `РИЛС\n${reelToText(e)}`,
    `ЭКСПЕРТНАЯ ЛИНЗА\n${e.expertLens.map((q) => `«${q.quote}» — ${q.name}${q.role ? `, ${q.role}` : ""} (${q.source}, ${q.date}) ${q.url}`).join("\n\n")}`,
    `ФАКТЫ И ИСТОЧНИКИ\n${factsToText(e)}`,
    `ЗАПАСНЫЕ ТЕМЫ\n${e.backupTopics.map((t) => `— ${t.title} (${t.url})${t.note ? ` — ${t.note}` : ""}`).join("\n")}`,
    e.unverified.length ? `НЕ УДАЛОСЬ ПРОВЕРИТЬ\n${e.unverified.map((u) => `— ${u}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/* ---------- Лента дня ----------
   Раздел приносит РАЗБОР новости, а сценарий пишется по кнопке. Поэтому
   функции ниже разделены надвое: разбор темы есть всегда, форматы — только
   когда владелец их заказал. */

export function feedStoriesToText(sc: FeedScript) {
  const frames = sc.stories.frames
    .map((f) => {
      const lines = [`Кадр ${f.n} — ${f.visual}`, f.text];
      if (f.interactive) lines.push(`Интерактив: ${f.interactive}`);
      return lines.join("\n");
    })
    .join("\n\n");
  return `Замысел: ${sc.stories.idea}\n\n${frames}`;
}

export function feedCarouselToText(sc: FeedScript) {
  const slides = sc.carousel.slides.map((s) => `Слайд ${s.n}. ${s.title}\n${s.body}`).join("\n\n");
  return `Замысел: ${sc.carousel.idea}\n\n${slides}\n\nПодпись к посту:\n${sc.carousel.caption}`;
}

export function feedReelToText(sc: FeedScript) {
  const script = sc.reel.script.map((l) => `${l.time} — ${l.text}`).join("\n");
  return [
    `Замысел: ${sc.reel.idea}`,
    `Хук: ${sc.reel.hook}`,
    script,
    sc.reel.captions.length ? `Надписи на экране: ${sc.reel.captions.join(" · ")}` : "",
    `Призыв: ${sc.reel.cta}`,
    `Подпись к рилсу:\n${sc.reel.caption}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Только тексты на экране — то, что вставляют в Instagram без пометок. */
export function feedStoriesTextsOnly(sc: FeedScript) {
  return sc.stories.frames.map((f) => f.text).join("\n\n");
}

export function feedCarouselTextsOnly(sc: FeedScript) {
  return sc.carousel.slides.map((s) => `${s.title}\n\n${s.body}`).join("\n\n");
}

export function feedReelTextsOnly(sc: FeedScript) {
  return [sc.reel.hook, ...sc.reel.script.map((l) => l.text), sc.reel.cta].join("\n\n");
}

export function feedSourcesToText(t: FeedTopic) {
  return t.sources
    .map((s) => `— ${s.title} (${s.outlet}${s.date ? `, ${s.date}` : ""}) ${s.url}${s.opened ? " [открыт]" : ""}`)
    .join("\n");
}

/** Весь сценарий темы. Пусто, если он ещё не заказан. */
export function feedScriptToText(t: FeedTopic) {
  if (!t.script) return "";
  return [
    `СТОРИС\n${feedStoriesToText(t.script)}`,
    `КАРУСЕЛЬ\n${feedCarouselToText(t.script)}`,
    `РИЛС\n${feedReelToText(t.script)}`,
    t.script.unverified.length
      ? `!! ПРОВЕРЬТЕ ПЕРЕД ПУБЛИКАЦИЕЙ — этого нет на скачанных страницах: ${t.script.unverified.join(" · ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Разбор темы без сценария: то, ради чего раздел и открывают утром.
 * Именно это копируют, когда хотят переслать новость или сохранить себе.
 */
export function feedTopicToText(t: FeedTopic) {
  return [
    `${FEED_KIND_LABEL[t.kind].toUpperCase()}: ${t.title}`,
    t.summary ? `О ЧЁМ\n${t.summary}` : "",
    t.details.length ? `ДЕТАЛИ\n${t.details.map((d) => `— ${d}`).join("\n")}` : "",
    t.soWhat ? `ЧТО ЭТО ЗНАЧИТ\n${t.soWhat}` : "",
    `Почему сейчас: ${t.whyNow}`,
    `Угол: ${t.angle}`,
    t.audienceQuestion ? `Вопрос аудитории: ${t.audienceQuestion}` : "",
    t.facts.length
      ? `ФАКТЫ\n${t.facts
          .map(
            (f, i) =>
              `${i + 1}. ${f.fact}\n   ${f.source} — ${f.url} — ${f.date} — ${LEVEL_LABEL[f.level]} — уверенность: ${CONFIDENCE_LABEL[f.confidence]}`,
          )
          .join("\n")}`
      : "",
    `ИСТОЧНИКИ (достоверность ${t.credibility.score} из 100)\n${feedSourcesToText(t)}`,
    t.mentions.length
      ? `НАЗВАНЫ НА СТРАНИЦЕ — адресов нет, ставить их в контент нельзя\n${t.mentions.map((m) => `— ${m}`).join("\n")}`
      : "",
    t.evidence ? `ПОДТВЕРЖДЕНИЕ СО СТРАНИЦЫ\n«${t.evidence}»` : "",
    feedScriptToText(t),
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function feedToText(f: DailyFeed) {
  return [
    `ЛЕНТА ЗА ${f.date} · ${f.weekday}`,
    f.shortfall,
    ...f.topics.map((t, i) => `ТЕМА №${i + 1}\n${feedTopicToText(t)}`),
  ]
    .filter(Boolean)
    .join("\n\n════════════════════\n\n");
}
