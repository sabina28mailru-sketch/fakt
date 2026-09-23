

/** Месяцы в родительном падеже: даты на страницах пишут и словами тоже. */

/**
 * Проверки страницы, не зависящие ни от моделей, ни от сети.
 *
 * Вынесены из feed.ts отдельным модулем по одной причине: их нужно
 * проверять тестами, а сборка feed.ts тянет SDK Gemini целиком. Чистая
 * функция, которую нельзя проверить без сетевого клиента, — плохая
 * чистая функция.
 */

export function normalizeDate(date: string): string {
  if (!date) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const t = Date.parse(date);
  if (Number.isNaN(t)) return "";
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * Страница-витрина: лента тегов, рубрика, список публикаций. Текста на ней
 * много, цитата с неё находится, и отбор честно говорит «подходит» — но
 * темой она быть не может, у неё нет содержания. Поймал живой прогон:
 * в ленту встала страница «#personalbranding #aiinmarketing … - LinkedIn».
 */
export function isFeedPage(title: string, url: string): boolean {
  // Два и более хештега в заголовке — это подпись к ленте, а не заголовок статьи.
  const hashtags = (title.match(/#[a-zA-Z0-9_\u0430-\u044f\u0451]+/g) ?? []).length;
  if (hashtags >= 2) return true;
  // Сверяем СЕГМЕНТЫ пути, а не подстроку: «tag» встречается внутри «montage»,
  // и проверка по вхождению выбрасывала бы нормальные статьи.
  let segments: string[] = [];
  try {
    segments = new URL(url).pathname.toLowerCase().split("/").filter(Boolean);
  } catch {
    segments = [];
  }
  if (segments.some((seg) => LISTING_SEGMENTS.has(seg))) return true;
  return /^(публикации|все материалы|posts|articles)\b/i.test(title.trim());
}

/** Куски адреса, за которыми стоит перечень материалов, а не материал. */
const LISTING_SEGMENTS = new Set([
  "tag",
  "tags",
  "topic",
  "topics",
  "category",
  "categories",
  "search",
  "hashtag",
  "feed",
  "rubric",
  "label",
  "author",
]);


/**
 * Сравнение адресов без косметики: модель то добавит слеш в конце, то
 * потеряет utm-хвост. Буквальное сравнение выбрасывало настоящие факты —
 * на замере из четырёх фактов доезжал один.
 */
export function sameUrl(a: string, b: string): boolean {
  const clean = (u: string) => {
    try {
      const x = new URL(u.trim());
      return `${x.hostname.replace(/^www\./, "")}${x.pathname.replace(/\/+$/, "")}`.toLowerCase();
    } catch {
      return u.trim().toLowerCase().replace(/\/+$/, "");
    }
  };
  return clean(a) === clean(b);
}


/**
 * Дата публикации, которой можно верить. Приоритет у даты из выдачи Tavily:
 * её вернул поиск, а не модель. Дату, названную моделью, принимаем только
 * если она совпала с выдачей или реально встречается в тексте страницы.
 * Иначе дата остаётся пустой: от неё зависят свежесть и +10 к баллу, и у
 * модели, которой велено искать свежее, есть прямой стимул её подрисовать.
 */
export function pageDate(raw: unknown, fromSearch: string | undefined, pageText: string): string {
  const search = normalizeDate(fromSearch ?? "");
  if (search) return search;
  const told = normalizeDate(typeof raw === "string" ? raw : "");
  if (!told) return "";
  // Дата на странице может стоять как 2026-09-18, 18.09.2026 или 18 сентября.
  const [y, m, d] = told.split("-");
  const haystack = pageText.toLowerCase();
  const forms = [told, `${d}.${m}.${y}`, `${Number(d)}.${Number(m)}.${y}`, `${Number(d)} ${MONTHS_RU[Number(m) - 1]}`];
  return forms.some((f) => haystack.includes(f.toLowerCase())) ? told : "";
}


const MONTHS_RU = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

