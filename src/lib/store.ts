import { promises as fs } from "node:fs";
import path from "node:path";
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
} from "./schema";
import { DEFAULT_SETTINGS } from "./brief";

const DATA_DIR = path.join(process.cwd(), "data");
const EDITIONS_DIR = path.join(DATA_DIR, "editions");
const FEEDS_DIR = path.join(DATA_DIR, "feeds");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");

async function ensureDirs() {
  await fs.mkdir(EDITIONS_DIR, { recursive: true });
  await fs.mkdir(FEEDS_DIR, { recursive: true });
}

/* ---------- Выпуски ---------- */

export async function listEditions(): Promise<Edition[]> {
  await ensureDirs();
  const files = (await fs.readdir(EDITIONS_DIR)).filter((f) => f.endsWith(".json"));
  const editions: Edition[] = [];
  for (const file of files) {
    try {
      const raw = await fs.readFile(path.join(EDITIONS_DIR, file), "utf8");
      const parsed = EditionSchema.safeParse(JSON.parse(raw));
      if (parsed.success) editions.push(parsed.data);
    } catch {
      /* битый файл пропускаем */
    }
  }
  return editions.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function saveEdition(edition: Edition): Promise<string> {
  await ensureDirs();
  const file = path.join(EDITIONS_DIR, `${edition.id}.json`);
  await fs.writeFile(file, JSON.stringify(edition, null, 2), "utf8");
  return file;
}

/** id вида 2026-09-18, а при повторной генерации в тот же день — 2026-09-18-2, -3 … */
export async function nextEditionId(date: string): Promise<string> {
  await ensureDirs();
  const files = await fs.readdir(EDITIONS_DIR);
  if (!files.includes(`${date}.json`)) return date;
  let n = 2;
  while (files.includes(`${date}-${n}.json`)) n++;
  return `${date}-${n}`;
}

/* ---------- Настройки ---------- */

export async function readSettings(): Promise<Settings> {
  try {
    const raw = await fs.readFile(SETTINGS_FILE, "utf8");
    const parsed = SettingsSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
  } catch {
    /* файла нет — вернём дефолт */
  }
  return DEFAULT_SETTINGS;
}

export async function writeSettings(settings: Settings): Promise<void> {
  await ensureDirs();
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf8");
}

/* ---------- Исследование темы ---------- */

const RESEARCH_FILE = path.join(DATA_DIR, "research.json");

/** Сколько последних исследований храним: файл не должен разрастаться бесконечно. */
const KEEP_RESULTS = 30;

export async function readResearch(): Promise<ResearchStore> {
  try {
    const raw = await fs.readFile(RESEARCH_FILE, "utf8");
    const parsed = ResearchStoreSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
  } catch {
    /* файла нет — пустое хранилище */
  }
  return { tags: [], results: [] };
}

async function writeResearch(store: ResearchStore): Promise<void> {
  await ensureDirs();
  await fs.writeFile(RESEARCH_FILE, JSON.stringify(store, null, 2), "utf8");
}

/** Сохранить результат исследования, вытеснив самые старые. */
export async function saveResearchResult(result: ResearchResult): Promise<ResearchStore> {
  const store = await readResearch();
  const results = [result, ...store.results.filter((r) => r.topic !== result.topic)].slice(0, KEEP_RESULTS);
  const next = { ...store, results };
  await writeResearch(next);
  return next;
}

export async function writeResearchTags(tags: string[]): Promise<ResearchStore> {
  const store = await readResearch();
  const clean: string[] = [];
  for (const t of tags) {
    const tag = t.trim().replace(/^#+/, "").slice(0, 60);
    if (tag && !clean.some((x) => x.toLowerCase() === tag.toLowerCase())) clean.push(tag);
  }
  const next = { ...store, tags: clean.slice(0, 40) };
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

/** Лента за конкретный день. Файл на день: data/feeds/2026-09-23.json. */
export async function readFeed(date: string): Promise<DailyFeed | null> {
  try {
    const raw = await fs.readFile(path.join(FEEDS_DIR, `${date}.json`), "utf8");
    const parsed = DailyFeedSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function saveFeed(feed: DailyFeed): Promise<void> {
  await ensureDirs();
  await fs.writeFile(path.join(FEEDS_DIR, `${feed.id}.json`), JSON.stringify(feed, null, 2), "utf8");
}

/** Ленты за последние дни, свежие первыми. */
export async function listFeeds(limit = FEED_MEMORY_DAYS): Promise<DailyFeed[]> {
  await ensureDirs();
  const files = (await fs.readdir(FEEDS_DIR))
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse()
    .slice(0, limit);
  const feeds: DailyFeed[] = [];
  for (const file of files) {
    try {
      const raw = await fs.readFile(path.join(FEEDS_DIR, file), "utf8");
      const parsed = DailyFeedSchema.safeParse(JSON.parse(raw));
      if (parsed.success) feeds.push(parsed.data);
    } catch {
      /* битый файл пропускаем */
    }
  }
  return feeds;
}

/**
 * Чем лента уже занималась: заголовки тем и адреса использованных источников.
 * Это вход для защиты от повторов. Заголовки уходят в промпт как запрет,
 * адреса — в código-проверку: один и тот же материал не может лечь в основу
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

const USAGE_FILE = path.join(DATA_DIR, "usage.json");

/** Текущий месяц как ГГГГ-ММ. Считаем по UTC: месяц — не то, где нужна точность до часового пояса. */
function currentMonth(now = new Date()): string {
  return now.toISOString().slice(0, 7);
}

/**
 * Расход за текущий месяц. Если в файле лежит прошлый месяц — отдаём нули:
 * тариф Tavily месячный, и смешивать месяцы значило бы врать об остатке.
 */
export async function readUsage(now = new Date()): Promise<Usage> {
  const month = currentMonth(now);
  try {
    const raw = await fs.readFile(USAGE_FILE, "utf8");
    const parsed = UsageSchema.safeParse(JSON.parse(raw));
    if (parsed.success && parsed.data.month === month) return parsed.data;
  } catch {
    /* файла нет — начинаем с нуля */
  }
  return { month, tavilyCredits: 0, modelCalls: 0, runs: 0 };
}

/**
 * Прибавить расход одного прогона. Вызывается всеми тремя конвейерами:
 * кошелёк у них общий, и считать его порознь бессмысленно.
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
  await ensureDirs();
  await fs.writeFile(USAGE_FILE, JSON.stringify(next, null, 2), "utf8");
  return next;
}
