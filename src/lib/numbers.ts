import { norm } from "./text-match";

/**
 * Сверка чисел из готового контента с текстом скачанной страницы.
 *
 * Зачем это отдельно от проверки цитаты. Цитата подтверждает, что тема стоит
 * на реальном материале, — но в кадры, слайды и реплики модель пишет СВОИ
 * формулировки, и туда цифры попадают уже без всякой проверки. На живом
 * прогоне это дало кадр «Threads: 1,23 млн авторов, 13,52 млн сообщений.
 * Рост в 3,7-кратном темпе»: первые два числа со страницы, третьего нет ни
 * там, ни в фактах, ни в цитате — оно не выводится даже делением. Рядом при
 * этом стояла настоящая ссылка, то есть выдумка выглядела подтверждённой.
 * Это хуже, чем отсутствие проверки: непроверенное хотя бы не притворяется.
 *
 * Запрет в промпте здесь доказанно не держит — он там был и был нарушен.
 */

/**
 * Числа в тексте вместе с тем, как они написаны. Разделитель разрядов и
 * запятая против точки приводятся к одному виду, иначе «4,75» со страницы
 * и «4.75» из контента считались бы разными.
 */
function digitsOf(text: string): string {
  return text.replace(/[  \s]/g, "").replace(/,/g, ".");
}

/**
 * Числа, за которые отвечаем. Мелкие целые пропускаем намеренно: «3 шага»,
 * «за 2 минуты», «кадр 5» — это структура речи, а не утверждение о мире,
 * и требовать их присутствия на странице значило бы топить проверку
 * в ложных срабатываниях.
 */
const MIN_PLAIN_INTEGER = 13;

/**
 * Годы вокруг текущего. «В 2026 году алгоритмы работают так-то» — указание
 * времени, а не утверждение о данных, и требовать его присутствия на
 * странице бессмысленно. На живом прогоне именно это дало семь ложных
 * срабатываний подряд и три лишних вызова модели на повторы.
 */
function nearbyYears(now: Date): Set<string> {
  const y = now.getFullYear();
  return new Set([y - 1, y, y + 1].map(String));
}

export function claimNumbers(text: string, ignore: ReadonlySet<string> = new Set()): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  // Число целиком, с возможными разрядами и дробной частью.
  const re = /\d[\d   ]*(?:[.,]\d+)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const raw = m[0].trim();
    const value = digitsOf(raw);
    if (!value) continue;
    const hasFraction = value.includes(".");
    const asNumber = Number(value);
    if (!hasFraction && Number.isFinite(asNumber) && Math.abs(asNumber) < MIN_PLAIN_INTEGER) continue;
    if (ignore.has(value)) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/**
 * Число подтверждено, если оно встречается в тексте хотя бы одной из
 * открытых страниц. Сверяем по нормализованному виду: страница пишет
 * «4,75 млн», контент — «4,75», и это одно и то же число.
 */
export function numberOnPages(value: string, pages: readonly string[]): boolean {
  return pages.some((p) => digitsOf(norm(p)).includes(value));
}

export interface NumberCheck {
  /** Где нашлось непроверяемое: «сторис, кадр 3». */
  where: string;
  /** Само число, как его написала модель. */
  value: string;
}

/**
 * Проверить все числа в наборе текстов. Возвращает только те, которых на
 * страницах нет: пустой список означает, что каждая цифра в контенте
 * действительно стоит на скачанной странице.
 */
export function checkNumbers(
  parts: { where: string; text: string }[],
  pages: readonly string[],
  now = new Date(),
): NumberCheck[] {
  const bad: NumberCheck[] = [];
  const ignore = nearbyYears(now);
  for (const part of parts) {
    for (const value of claimNumbers(part.text, ignore)) {
      if (!numberOnPages(value, pages)) bad.push({ where: part.where, value });
    }
  }
  return bad;
}

/**
 * Утверждения от первого лица о том, чего система знать не может: где
 * владелец был, с кем виделся, что делал. На живом прогоне модель написала
 * «Я только что вернулся с Brand Analytics Conference в Алматы» — владелец
 * опубликовал бы от своего имени факт своей биографии, которого не было.
 *
 * Полностью такое кодом не переловить, и мы не притворяемся, что ловим:
 * список покрывает самые частые обороты и служит поводом показать человеку
 * предупреждение, а не молча пропустить.
 */
/*
 * Важно: \w и \b в JavaScript не знают кириллицы — \w это [A-Za-z0-9_].
 * Из-за этого первая версия не ловила «вернулся» вовсе. Поэтому окончания
 * и границы слов написаны явными классами кириллических букв.
 */
const RU = "а-яё";
const START = `(?:^|[^${RU}])`;
const END = `(?![${RU}])`;

const FIRST_PERSON_CLAIMS = [
  // «Я только что вернулся с конференции», «я был на форуме»
  new RegExp(`${START}я\\s+(?:только\\s+что\\s+)?(?:вернул|приехал|прилетел|побывал|был|съезди)[${RU}]*\\s+(?:с|со|из|в|на)${END}`, "i"),
  // «Я встретился с…», «я поговорил с…»
  new RegExp(`${START}я\\s+(?:встретил|поговорил|пообщал|созвонил|познакомил)[${RU}]*\\s+с${END}`, "i"),
  // «Мы провели исследование», «мы запустили» — система этого знать не может
  new RegExp(`${START}мы\\s+(?:провели|запустили|выпустили|открыли|собрали)${END}`, "i"),
  new RegExp(`${START}(?:вчера|на\\s+прошлой\\s+неделе|позавчера)\\s+я\\s+[${RU}]+`, "i"),
  // «Мой клиент рассказал», «наш клиент» — конкретный кейс, которого нет в материалах
  new RegExp(`${START}(?:мой|наш)\\s+клиент${END}`, "i"),
];

export function firstPersonClaims(parts: { where: string; text: string }[]): NumberCheck[] {
  const out: NumberCheck[] = [];
  for (const part of parts) {
    for (const re of FIRST_PERSON_CLAIMS) {
      const m = part.text.match(re);
      if (m) {
        out.push({ where: part.where, value: m[0].trim() });
        break;
      }
    }
  }
  return out;
}
