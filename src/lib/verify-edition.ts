import type { EditionDraft, ExpertQuote, Fact } from "./schema";
import { evidenceInText } from "./text-match";
import { sameUrl } from "./page-guards";
import { checkNumbers, firstPersonClaims } from "./numbers";

/**
 * Проверка выпуска кодом.
 *
 * До этого модуля раздел «Выпуск» не проверял ничего: единственной преградой
 * между ответом модели и файлом на диске была форма Zod. В выпуске за
 * 22 сентября это дало дословную цитату реального человека со ссылкой на
 * страницу, где такого предложения нет, и четыре факта с «высокой
 * уверенностью» подряд.
 *
 * Механизм всё это время лежал рядом и работал в ленте — просто не был
 * подключён сюда. Правила те же самые, потому что обещание продукта одно
 * на все разделы: разная строгость в соседних разделах — это не гибкость,
 * а лазейка.
 */

export interface EditionCheck {
  expertLens: ExpertQuote[];
  facts: Fact[];
  unverified: string[];
  /** Строки для лога: человек должен видеть, что именно отсеяно и почему. */
  notes: string[];
}

export function verifyEdition(
  draft: EditionDraft,
  openedTexts: readonly string[],
  openedUrls: ReadonlySet<string>,
): EditionCheck {
  const unverified: string[] = [];
  const notes: string[] = [];

  /*
   * Цитата, выданная за дословную, обязана найтись на скачанной странице.
   * Не нашлась — не в кавычки, а в список непроверенного: пересказ с именем
   * настоящего человека и ссылкой рядом хуже, чем отсутствие цитаты.
   */
  const expertLens = draft.expertLens.filter((q) => {
    if (!openedTexts.length) return true; // страницы не открывались — проверять нечем
    const ok = openedTexts.some((t) => evidenceInText(q.quote, t));
    if (!ok) {
      unverified.push(`Цитата ${q.name} не найдена на скачанных страницах — убрана из экспертной линзы.`);
      notes.push(`Цитата «${q.quote.slice(0, 60)}…» (${q.name}) на странице не найдена — отброшена.`);
    }
    return ok;
  });

  /*
   * Высокая уверенность означает «первоисточник открыт». Если страницу с
   * этим адресом мы не скачивали, ставить high нельзя — это ровно то
   * обещание, которое бриф даёт пользователю.
   */
  const facts = draft.facts.map((f) => {
    if (f.confidence !== "high") return f;
    const opened = [...openedUrls].some((u) => sameUrl(u, f.url));
    if (opened) return f;
    notes.push(`Факт «${f.fact.slice(0, 50)}…» помечен средней уверенностью: страница ${f.url} не открывалась.`);
    return { ...f, confidence: "medium" as const };
  });

  // Цифры в самом контенте: тот же провал, что поймали в ленте.
  const parts = [
    ...draft.stories.frames.map((fr) => ({ where: `сторис, кадр ${fr.n}`, text: fr.text })),
    ...draft.carousel.slides.map((sl) => ({ where: `карусель, слайд ${sl.n}`, text: `${sl.title} ${sl.body}` })),
    { where: "карусель, подпись", text: draft.carousel.caption },
    { where: "рилс, хук", text: draft.reel.hook },
    ...draft.reel.script.map((l, n) => ({ where: `рилс, реплика ${n + 1}`, text: l.text })),
  ];
  if (openedTexts.length) {
    for (const bad of checkNumbers(parts, openedTexts)) {
      unverified.push(`${bad.where}: числа ${bad.value} нет ни на одной открытой странице.`);
    }
  }
  for (const claim of firstPersonClaims(parts)) {
    unverified.push(`${claim.where}: «${claim.value}…» — система не может знать, что это было.`);
  }

  return { expertLens, facts, unverified, notes };
}
