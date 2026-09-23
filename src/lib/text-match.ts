/**
 * Сверка текста моделью сказанного с текстом реально открытой страницы.
 *
 * Здесь живёт одно правило продукта: утверждению модели не верим. Когда она
 * говорит «на странице есть искусственный интеллект» или приводит цитату,
 * присутствие проверяет код — по тексту, который мы сами скачали. На прогоне
 * модель уверенно «нашла» AI на странице про лечение зубов под микроскопом,
 * где его нет; после этого решение и переехало в код.
 *
 * Модуль общий для раздела «Темы» (research.ts) и ленты дня (feed.ts):
 * строгость проверки в них обязана быть одинаковой, иначе лента станет
 * лазейкой в обход правил исследования.
 */

/** Нормализация для сверки с текстом страницы: регистр и пробелы не должны мешать. */
export function norm(text: string): string {
  return text
    .toLowerCase()
    .replace(/[«»"'`ё]/g, (c) => (c === "ё" ? "е" : ""))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Основа слова. Русский язык склоняет всё: в тексте стоит «медийности»,
 * «публичностью», «личного бренда», а в списке вариантов — словарная форма.
 * Буквальное сравнение резало живые материалы: по запросу про медийность
 * отбраковывались страницы, которые модель прямо признала подходящими.
 * Точной морфологии здесь не нужно — достаточно отбросить окончание.
 */
export function stem(word: string): string {
  if (word.length <= 5) return word;
  return word.slice(0, Math.max(5, word.length - 3));
}

/** Союзы и предлоги: в названии понятия они есть, а в тексте могут не встретиться рядом. */
const STOP = new Set(["и", "или", "в", "на", "для", "с", "по", "от", "the", "and", "of", "for", "in", "to"]);

/** Значимые слова фразы. Короткие оставляем как есть: «PR», «ИИ», «AI» — полноценные термины. */
export function words(phrase: string): string[] {
  return norm(phrase)
    .split(/[^a-zа-я0-9]+/i)
    .filter((w) => w.length >= 2 && !STOP.has(w));
}

/**
 * Одно слово присутствует в тексте. Короткие термины («PR», «ИИ») ищем как
 * отдельное слово: иначе «pr» находится внутри «природа» и даёт ложное
 * совпадение. Длинные — по основе, чтобы пережить склонение.
 */
export function wordInText(word: string, haystack: string): boolean {
  if (word.length <= 3) {
    return new RegExp(`(^|[^a-zа-я0-9])${word}([^a-zа-я0-9]|$)`, "i").test(haystack);
  }
  return haystack.includes(stem(word));
}

/**
 * Понятие найдено, если хотя бы один его вариант присутствует в тексте:
 * все значимые слова варианта встречаются своими основами.
 */
export function conceptInText(concept: { name: string; variants: string[] }, pageText: string): boolean {
  const haystack = norm(pageText);
  return [concept.name, ...concept.variants].some((v) => {
    const parts = words(v);
    if (!parts.length) return false;
    return parts.every((w) => wordInText(w, haystack));
  });
}

/** Только буквы и цифры: пунктуация и типографика при сверке цитаты не важны. */
export function letters(text: string): string {
  return norm(text).replace(/[^a-zа-я0-9]+/gi, "");
}

/**
 * Цитата обязана реально присутствовать на странице. Это прямая проверка
 * требования «есть ли в самом источнике подтверждение связи» и защита
 * от выдуманных цитат. Сравниваем по буквам: модель то поправит тире,
 * то уберёт лишний пробел, и точное сравнение давало ложные отказы.
 */
export function evidenceInText(evidence: string, pageText: string): boolean {
  const haystack = letters(pageText);
  const quote = letters(evidence);
  if (quote.length < 20) return false;
  if (haystack.includes(quote)) return true;
  // Хвост цитаты модель нередко обрезает — достаточно устойчивого начала.
  const head = quote.slice(0, 50);
  return head.length >= 30 && haystack.includes(head);
}

/**
 * Насколько две темы — про одно и то же. Нужно, чтобы завтрашняя лента не
 * повторила вчерашнюю другими словами: заголовки почти никогда не совпадают
 * дословно, а смысл повторяется. Считаем долю общих основ значимых слов.
 */
export function titleOverlap(a: string, b: string): number {
  const left = new Set(words(a).map(stem));
  const right = new Set(words(b).map(stem));
  if (!left.size || !right.size) return 0;
  let common = 0;
  for (const w of left) if (right.has(w)) common++;
  return common / Math.min(left.size, right.size);
}
