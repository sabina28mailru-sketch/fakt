/**
 * Поиск и открытие первоисточников. Всё, что ходит в интернет, живёт здесь.
 *
 * Поиск — Tavily (/search) строго по спискам доменов из брифа.
 * Открытие страницы — сначала обычный запрос своими силами (бесплатно),
 * а если издание режет ботов или страница рисуется скриптом — Tavily /extract.
 */

const SEARCH_URL = "https://api.tavily.com/search";
const EXTRACT_URL = "https://api.tavily.com/extract";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

/** Сколько знаков страницы отдаём модели: дальше начинается подвал и реклама. */
const PAGE_LIMIT = 12000;
/** Страница считается открытой, если текста больше этого — иначе это заглушка или JS-каркас. */
const MIN_PAGE_CHARS = 1500;

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
  publishedDate?: string;
}

export interface OpenedPage {
  url: string;
  text: string;
  via: "fetch" | "extract";
}

export interface FailedPage {
  url: string;
  reason: string;
}

/** Сколько страниц тянем одновременно. Выше — упираемся в исходящие соединения Node. */
const FETCH_PARALLEL = 10;
/** Сколько поисковых запросов шлём одновременно. Tavily это держит, лимит у него не поминутный. */
const SEARCH_PARALLEL = 5;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Выполнить задачи с ограничением на одновременность, сохранив порядок
 * результатов. Promise.all без ограничения открыл бы четырнадцать соединений
 * сразу и поймал бы таймауты на ровном месте, а последовательный цикл —
 * то, из-за чего исследование и шло минутами.
 */
async function pool<T, R>(items: readonly T[], limit: number, work: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await work(items[i], i);
    }
  });
  await Promise.all(runners);
  return out;
}

/**
 * Сеть в реальных условиях рвётся (ECONNRESET, таймаут соединения), причём
 * и до Tavily тоже. Без повторов прогон срывается на ровном месте.
 */
async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (i < tries - 1) await sleep(1200 * (i + 1));
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

function errText(e: unknown): string {
  if (e instanceof Error) {
    const cause = (e as { cause?: { message?: string } }).cause;
    return cause?.message ?? e.message;
  }
  return String(e);
}

/** Один поисковый запрос, ограниченный списком доменов. */
export async function tavilySearch(
  apiKey: string,
  query: string,
  domains: readonly string[],
  opts: {
    maxResults?: number;
    timeRange?: "week" | "month" | "year";
    depth?: "basic" | "advanced";
    excludeDomains?: readonly string[];
  } = {},
): Promise<{ hits: SearchHit[]; credits: number }> {
  // Пустой список доменов — поиск по всему вебу: так работает исследование
  // произвольной темы, где списки источников из брифа неприменимы.
  // Для выпуска список непустой, и тогда ограничение обязано быть жёстким:
  // в режиме по умолчанию (prefer) Tavily при слабом совпадении молча
  // возвращает что угодно вместо запрошенных доменов.
  const restricted = domains.length > 0;
  const body: Record<string, unknown> = {
    query,
    search_depth: opts.depth ?? "advanced",
    max_results: opts.maxResults ?? 6,
    time_range: opts.timeRange ?? "month",
    include_published_date: true,
    include_usage: true,
  };
  if (restricted) {
    body.include_domains = [...domains];
    body.include_domains_mode = "restrict";
  }
  if (opts.excludeDomains?.length) {
    body.exclude_domains = [...opts.excludeDomains];
  }

  const data = await withRetry(async () => {
    const res = await fetch(SEARCH_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = (await res.text()).slice(0, 300);
      throw new Error(`Tavily ответил ${res.status}: ${text}`);
    }
    return (await res.json()) as {
      results?: { title?: string; url?: string; content?: string; published_date?: string }[];
      usage?: { credits?: number };
    };
  });

  const hits: SearchHit[] = (data.results ?? [])
    .filter((r): r is { url: string } & typeof r => Boolean(r.url))
    .map((r) => ({
      title: r.title ?? "",
      url: r.url,
      snippet: (r.content ?? "").slice(0, 700),
      publishedDate: r.published_date,
    }));

  return { hits, credits: data.usage?.credits ?? 0 };
}

export interface SearchOutcome {
  query: string;
  hits: SearchHit[];
  credits: number;
  error?: string;
}

/**
 * Пачка поисковых запросов разом. Запросы друг от друга не зависят, а по
 * очереди двенадцать штук по несколько секунд складывались в полторы минуты
 * ожидания на втором шаге. Неудача одного запроса не роняет пачку: он
 * возвращается с error, остальные результаты остаются в силе.
 */
export async function tavilySearchMany(
  apiKey: string,
  queries: readonly string[],
  domains: readonly string[],
  opts: Parameters<typeof tavilySearch>[3] = {},
): Promise<SearchOutcome[]> {
  return pool(queries, SEARCH_PARALLEL, async (query) => {
    try {
      const res = await tavilySearch(apiKey, query, domains, opts);
      return { query, hits: res.hits, credits: res.credits };
    } catch (e) {
      return { query, hits: [], credits: 0, error: errText(e) };
    }
  });
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Сколько ждём страницу своими силами. Было 20 секунд на каждую, и при
 * последовательном обходе четырнадцать медленных сайтов складывались в
 * четыре минуты ожидания. Сейчас обход параллельный, поэтому порог можно
 * держать низким: не отдавшая текст за 9 секунд страница всё равно уйдёт
 * в Tavily /extract, и это быстрее, чем дожидаться её самому.
 */
const FETCH_TIMEOUT_MS = 9000;

/** Открыть страницу своими силами. Без повторов: это быстрая попытка, подстраховка — extract. */
async function fetchPage(url: string): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,*/*;q=0.8", "Accept-Language": "ru,en;q=0.8" },
    });
    if (!res.ok) return null;
    const text = htmlToText(await res.text());
    return text.length >= MIN_PAGE_CHARS ? text : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Достать страницы через Tavily: пробивает 403 и отрисовку скриптами. */
async function extractPages(
  apiKey: string,
  urls: string[],
): Promise<{ pages: Map<string, string>; failed: Map<string, string>; credits: number }> {
  const pages = new Map<string, string>();
  const failed = new Map<string, string>();
  let credits = 0;
  if (!urls.length) return { pages, failed, credits };

  try {
    const data = await withRetry(async () => {
      const res = await fetch(EXTRACT_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ urls, extract_depth: "advanced", include_usage: true }),
      });
      if (!res.ok) throw new Error(`Tavily extract ответил ${res.status}`);
      return (await res.json()) as {
        results?: { url?: string; raw_content?: string }[];
        failed_results?: { url?: string; error?: string }[];
        usage?: { credits?: number };
      };
    });
    credits = data.usage?.credits ?? 0;
    for (const r of data.results ?? []) {
      if (r.url && r.raw_content) pages.set(r.url, htmlToText(r.raw_content));
    }
    for (const f of data.failed_results ?? []) {
      if (f.url) failed.set(f.url, f.error ?? "не удалось извлечь");
    }
  } catch (e) {
    for (const url of urls) failed.set(url, errText(e));
  }
  return { pages, failed, credits };
}

/**
 * Открыть список первоисточников. Сначала своими силами, для упрямых — через Tavily.
 * onLog зовётся по мере событий, чтобы панель конвейера показывала происходящее вживую.
 */
export async function openPages(
  apiKey: string,
  urls: string[],
  onLog: (kind: "fetch" | "result" | "warn", text: string) => void,
): Promise<{ pages: OpenedPage[]; failed: FailedPage[]; credits: number }> {
  const pages: OpenedPage[] = [];
  const needExtract: string[] = [];

  // Страницы независимы друг от друга, и последовательный обход был чистой
  // потерей времени: общее ожидание равнялось сумме, хотя должно равняться
  // самой медленной странице. Порядок результата сохраняем — он задаёт
  // очередь показа и порядок материалов для судейства.
  onLog("fetch", `Открываю ${urls.length} страниц разом`);
  const fetched = await pool(urls, FETCH_PARALLEL, (url) => fetchPage(url));

  urls.forEach((url, i) => {
    const text = fetched[i];
    if (text) {
      pages.push({ url, text: text.slice(0, PAGE_LIMIT), via: "fetch" });
      onLog("result", `Открыто: ${hostname(url)}`);
    } else {
      needExtract.push(url);
    }
  });

  let credits = 0;
  const failed: FailedPage[] = [];
  if (needExtract.length) {
    onLog("fetch", `Через Tavily: ${needExtract.length} страниц, которые не отдались напрямую`);
    const res = await extractPages(apiKey, needExtract);
    credits = res.credits;
    for (const url of needExtract) {
      const text = res.pages.get(url);
      if (text && text.length >= MIN_PAGE_CHARS) {
        pages.push({ url, text: text.slice(0, PAGE_LIMIT), via: "extract" });
        onLog("result", `Открыто через Tavily: ${hostname(url)}`);
      } else {
        const reason = res.failed.get(url) ?? "страница не отдала текст";
        failed.push({ url, reason });
        onLog("warn", `Страница не открылась: ${hostname(url)} — ${reason}`);
      }
    }
  }

  return { pages, failed, credits };
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
