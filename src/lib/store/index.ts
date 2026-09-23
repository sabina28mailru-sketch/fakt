import {
  DailyFeedSchema,
  EditionSchema,
  ResearchStoreSchema,
  SettingsSchema,
  UsageSchema,
  type DailyFeed,
  type Edition,
  type ResearchResult,
  type ResearchStore,
  type Settings,
  type Usage,
} from "../schema";
import { DEFAULT_SETTINGS } from "../brief";
import type { DocStore } from "./docs";
import { createFileStore } from "./docs-fs";

/**
 * Хранилище приложения.
 *
 * Функции ниже написаны ОДИН раз поверх документного интерфейса, а файлы
 * или база подставляются под них. Дублировать четырнадцать функций для
 * каждого способа хранения значило бы чинить любую правку дважды и
 * однажды забыть про вторую.
 *
 * Способ выбирается по наличию DATABASE_URL:
 *   есть   — Postgres, для бессерверного хостинга, где файлы не живут;
 *   нет    — файлы в data/, как было с самого начала.
 *
 * Локально базу поднимать незачем: один пользователь, один компьютер,
 * и файлы под рукой в редакторе.
 */

let store: DocStore | null = null;

/**
 * Хранилище. Драйвер базы подгружается по требованию: без DATABASE_URL он
 * не нужен вовсе, и тянуть его в локальную сборку незачем.
 */
async function getStore(): Promise<DocStore> {
  if (store) return store;
  const url = process.env.DATABASE_URL;
  if (url) {
    const { createDbStore } = await import("./docs-db");
    store = createDbStore(url);
  } else {
    store = createFileStore();
  }
  return store;
}

/** Работает ли приложение на базе. Нужно интерфейсу, чтобы честно об этом сказать. */
export function usesDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

/* ---------- Выпуски ---------- */

export async function listEditions(): Promise<Edition[]> {
  const raw = await (await getStore()).list("edition");
  const out: Edition[] = [];
  for (const item of raw) {
    const parsed = EditionSchema.safeParse(item);
    // Битый выпуск пропускаем: один испорченный документ не должен
    // ронять всю историю. Но список короче ожидаемого — повод проверить.
    if (parsed.success) out.push(parsed.data);
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function saveEdition(edition: Edition): Promise<string> {
  await (await getStore()).put("edition", edition.id, edition);
  return edition.id;
}

/** id вида 2026-09-18, а при повторной генерации в тот же день — 2026-09-18-2, -3 … */
export async function nextEditionId(date: string): Promise<string> {
  const keys = new Set(await (await getStore()).keys("edition"));
  if (!keys.has(date)) return date;
  let n = 2;
  while (keys.has(`${date}-${n}`)) n++;
  return `${date}-${n}`;
}

/* ---------- Настройки ---------- */

export async function readSettings(): Promise<Settings> {
  const raw = await (await getStore()).get("settings", "settings");
  const parsed = SettingsSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

export async function writeSettings(settings: Settings): Promise<void> {
  await (await getStore()).put("settings", "settings", settings);
}

/* ---------- Исследование темы ---------- */

/** Сколько последних исследований храним: хранилище не должно разрастаться бесконечно. */
const KEEP_RESULTS = 30;

export async function readResearch(): Promise<ResearchStore> {
  const raw = await (await getStore()).get("research", "research");
  const parsed = ResearchStoreSchema.safeParse(raw);
  return parsed.success ? parsed.data : { tags: [], results: [] };
}

async function writeResearch(next: ResearchStore): Promise<void> {
  await (await getStore()).put("research", "research", next);
}

/** Сохранить результат исследования, вытеснив самые старые. */
export async function saveResearchResult(result: ResearchResult): Promise<ResearchStore> {
  const current = await readResearch();
  const results = [result, ...current.results.filter((r) => r.topic !== result.topic)].slice(0, KEEP_RESULTS);
  const next = { ...current, results };
  await writeResearch(next);
  return next;
}

export async function writeResearchTags(tags: string[]): Promise<ResearchStore> {
  const current = await readResearch();
  const clean: string[] = [];
  for (const t of tags) {
    const tag = t.trim().replace(/^#+/, "").slice(0, 60);
    if (tag && !clean.some((x) => x.toLowerCase() === tag.toLowerCase())) clean.push(tag);
  }
  const next = { ...current, tags: clean.slice(0, 40) };
  await writeResearch(next);
  return next;
}

/* ---------- Лента дня ---------- */

/**
 * Сколько прошлых лент просматриваем, чтобы не повторить тему. Тридцать
 * дней — разумный горизонт: за месяц инфоповод успевает отработать, и
 * возвращаться к нему уже не грех, а через неделю — ещё как грех.
 */
const FEED_MEMORY_DAYS = 30;

export async function readFeed(date: string): Promise<DailyFeed | null> {
  const raw = await (await getStore()).get("feed", date);
  const parsed = DailyFeedSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export async function saveFeed(feed: DailyFeed): Promise<void> {
  await (await getStore()).put("feed", feed.id, feed);
}

/** Ленты за последние дни, свежие первыми. */
export async function listFeeds(limit = FEED_MEMORY_DAYS): Promise<DailyFeed[]> {
  const raw = await (await getStore()).list("feed", limit);
  const out: DailyFeed[] = [];
  for (const item of raw) {
    const parsed = DailyFeedSchema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

/**
 * Чем лента уже занималась: заголовки тем и адреса использованных источников.
 * Это вход для защиты от повторов. Заголовки уходят в промпт как запрет,
 * адреса — в проверку кодом: один и тот же материал не может лечь в основу
 * двух разных дней, даже если модель переименует тему.
 *
 * Берём и выпуски тоже: раздел «Выпуск» пишет о том же личном бренде, и
 * повторить вчерашний выпуск в сегодняшней ленте — такой же повтор.
 */
export async function readFeedMemory(): Promise<{ titles: string[]; urls: Set<string> }> {
  const [feeds, editions] = await Promise.all([listFeeds(), listEditions()]);
  const titles: string[] = [];
  const urls = new Set<string>();
  for (const feed of feeds) {
    for (const topic of feed.topics) {
      titles.push(topic.title);
      for (const src of topic.sources) urls.add(src.url);
    }
  }
  for (const edition of editions.slice(0, FEED_MEMORY_DAYS)) {
    titles.push(edition.topic.title);
    for (const fact of edition.facts) urls.add(fact.url);
  }
  return { titles, urls };
}

/* ---------- Расход внешних сервисов ---------- */

/** Текущий месяц как ГГГГ-ММ. Считаем по UTC: месяц — не то, где нужна точность до часового пояса. */
function currentMonth(now = new Date()): string {
  return now.toISOString().slice(0, 7);
}

/**
 * Расход за текущий месяц. Если записан прошлый месяц — отдаём нули:
 * тариф Tavily месячный, и смешивать месяцы значило бы врать об остатке.
 */
export async function readUsage(now = new Date()): Promise<Usage> {
  const month = currentMonth(now);
  const parsed = UsageSchema.safeParse(await (await getStore()).get("usage", "usage"));
  if (parsed.success && parsed.data.month === month) return parsed.data;
  return { month, tavilyCredits: 0, modelCalls: 0, runs: 0 };
}

/**
 * Прибавить расход одного прогона. Вызывается всеми конвейерами: кошелёк
 * у них общий, и считать его порознь бессмысленно.
 */
export async function addUsage(
  spent: { tavilyCredits?: number; modelCalls?: number },
  now = new Date(),
): Promise<Usage> {
  const current = await readUsage(now);
  const next: Usage = {
    month: current.month,
    tavilyCredits: current.tavilyCredits + Math.max(0, Math.round(spent.tavilyCredits ?? 0)),
    modelCalls: current.modelCalls + Math.max(0, Math.round(spent.modelCalls ?? 0)),
    runs: current.runs + 1,
  };
  await (await getStore()).put("usage", "usage", next);
  return next;
}
