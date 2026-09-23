

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


/**
 * Признаки материала, которые можно установить ПО ТЕКСТУ, а не спросить
 * у модели.
 *
 * Разбор проекта показал перекос: из восьми сигналов, из которых считается
 * балл достоверности, кодом ограничивались три, а оба штрафа были
 * самодоносом — модель должна была сама сообщить, что материал кликбейтный.
 * Недосообщила — получила почти тридцать баллов сверху. На таких весах
 * честная статья набирала «низкая», а уверенный пост в соцсети «высокую».
 *
 * Здесь собрано то, что проверяется без модели. Остальное по-прежнему
 * приходит от неё, и об этом честнее сказать прямо, чем делать вид,
 * что проверено всё.
 */

/** Сколько отдельных чисел делают материал «конкретным». */
const CONCRETE_MIN_NUMBERS = 2;

/** В тексте есть конкретика: числа, а не одни рассуждения. */
export function hasConcreteNumbers(pageText: string, min = CONCRETE_MIN_NUMBERS): boolean {
  const found = pageText.match(/\d[\d   ]*(?:[.,]\d+)?/g) ?? [];
  const meaningful = new Set(found.map((x) => x.replace(/[\s  ]/g, "").replace(",", ".")));
  return meaningful.size >= min;
}

/** Домены, за которыми стоит учреждение, а не редакция или автор. */
const OFFICIAL_HOSTS = [".gov", ".gov.kz", ".edu", ".ac.uk", "who.int", "oecd.org", "worldbank.org", "stat.gov.kz"];
const RESEARCH_HOSTS = ["doi.org", "arxiv.org", "nature.com", "science.org", "pubmed.ncbi.nlm.nih.gov", "jstor.org"];

/**
 * Официальный или научный источник по адресу. Заявление модели об этом
 * стоит +10 к баллу, и подтверждать его доменом дешевле, чем верить.
 */
export function isOfficialOrResearch(url: string): boolean {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return [...OFFICIAL_HOSTS, ...RESEARCH_HOSTS].some((d) => host === d || host.endsWith(d));
}

/**
 * Кликбейт по заголовку. Раньше штраф ставился только если модель сама
 * донесёт на материал; теперь самые явные признаки видит код.
 */
export function looksClickbait(title: string): boolean {
  const t = title.trim();
  if (!t) return false;
  if (/[!?]{2,}/.test(t)) return true;
  // \b в JavaScript не знает кириллицы (\w это [A-Za-z0-9_]), поэтому
  // граница слова написана явным классом: без этого «Шок:» не ловился.
  if (/(^|[^а-яёa-z])(шок|сенсаци|вы не поверите|никто не ожидал|взорвал интернет|срочно)/i.test(t)) return true;
  if (/(секрет|правд|лайфхак|способ|ошибк)[а-яё]*\s*,?\s*котор[а-яё]+\s+(скрыва|молчат|не расскаж)/i.test(t)) {
    return true;
  }
  // Заголовок капсом целиком: не стиль, а крик.
  const letters = t.replace(/[^A-Za-zА-Яа-яЁё]/g, "");
  if (letters.length >= 12 && letters === letters.toUpperCase()) return true;
  return false;
}
