import { GoogleGenAI } from "@google/genai";
import {
  FEED_KINDS,
  FeedTopicDraftSchema,
  type DailyFeed,
  type Fact,
  type FeedEvent,
  type FeedKind,
  type FeedTopic,
  type ResearchSource,
  type Settings,
} from "./schema";
import { buildFeedAgendaSystem, buildFeedSiftSystem, buildFeedWriteSystem } from "./brief";
import {
  askFast,
  askRef,
  describeModelError,
  refLabel,
  lanesFor,
  siftRotation,
  writeRotation,
  type ModelRef,
} from "./model";
import { openPages, tavilySearchMany, type SearchHit } from "./search";
import { ageInDays, freshnessOf, scoreCredibility, type CredibilitySignals } from "./credibility";
import { evidenceInText, titleOverlap } from "./text-match";
import { readFeedMemory, saveFeed } from "./store";
import { FEED_KIND_LABEL, hostOf, weekdayRu } from "./utils";

/**
 * Лента дня: три темы разных типов, каждая с тремя направлениями контента.
 *
 * Главное устройство — разделение труда между моделью и кодом. Модель ищет
 * формулировки, читает страницы и пишет контент. Код решает всё, на чём
 * держится обещание продукта: какая цитата настоящая, какой материал чем
 * подтверждён, какие три темы попадут в ленту и не повторяют ли они
 * вчерашние. Доверять это модели нельзя — она охотно выдаёт три вариации
 * одной темы и уверенно цитирует то, чего на странице нет.
 *
 * Бюджет вызовов модели за прогон: 1 (повестка, на lite) + 3 (отбор пачками)
 * + 3 (написание) = 7 в спокойном случае. На замере вышло 12: когда у модели
 * кончается суточная квота, пачка или тема уходит на соседнюю, и каждая
 * попытка считается. Поэтому обещать «семь» нельзя — честный разброс 7–13,
 * но все они размазаны по пяти моделям с раздельными квотами, и ни одна
 * не тратит больше двух-трёх запросов из своих двадцати.
 */

/** Сколько поисковых запросов на каждый тип темы. Три типа × 3 = 9 запросов. */
const PER_KIND_QUERIES = 3;
/** Сколько страниц открываем целиком. Судим по тексту, а не по сниппету. */
const MAX_OPEN = 12;
/**
 * Сколько знаков страницы показываем модели на отборе. Урезано с 3500:
 * у Groq ограничение на токены в минуту, и две пачки по четыре страницы
 * его пробивали. На проверку это не влияет — цитату код сверяет с ПОЛНЫМ
 * текстом страницы, а не с тем куском, который видела модель.
 */
const SIFT_CHARS = 2600;
/**
 * Сколько страниц разбираем одним вызовом. Четыре — предел, проверенный
 * живым прогоном: шесть страниц (около 21 000 знаков) Groq отверг с 413,
 * у него ограничение на токены в минуту. Четыре проходят за 5–8 секунд.
 */
const SIFT_CHUNK = 4;
/** Сколько моделей пробует одна пачка, прежде чем сдаться. */
const SIFT_ATTEMPTS = 3;
/** Сколько дополнительных материалов подпирают тему помимо основного. */
const SUPPORT_PER_TOPIC = 2;
/**
 * Порог совпадения заголовков, за которым тема считается повтором.
 * 0.6 — это когда больше половины значимых слов те же: «Instagram меняет
 * ленту» и «Как Instagram изменил ленту» не пройдут оба.
 */
const REPEAT_OVERLAP = 0.6;

/**
 * Витрины без содержательного текста: открывать их незачем, судить не по чему.
 * Исключаются из поиска всегда.
 */
const HARD_NOISE = ["instagram.com", "facebook.com", "threads.com", "tiktok.com", "pinterest.com", "youtube.com"];

/**
 * Площадки авторских публикаций и обсуждений. Раньше они тоже были в общем
 * списке исключений — и тема типа «мнение и спор» не находилась ни разу:
 * споры экспертов живут именно здесь, а не в новостных лентах. Теперь они
 * ищутся наравне со всеми, но редакционной ответственности за ними нет,
 * поэтому признак «издание с репутацией» им не засчитывается и балл ниже.
 */
const SELF_PUBLISHED = [
  "x.com",
  "twitter.com",
  "reddit.com",
  "quora.com",
  "linkedin.com",
  "medium.com",
  "substack.com",
  "dzen.ru",
  "vc.ru",
  "telegra.ph",
];

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error(`В ответе модели нет JSON-объекта. Начало ответа: ${text.slice(0, 200)}`);
  }
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    throw new Error(`Ответ модели оборвался и не разобрался как JSON. Начало: ${text.slice(0, 200)}`);
  }
}

function parseStrings(raw: unknown, limit: number): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, limit);
}

function normalizeDate(date: string): string {
  if (!date) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const t = Date.parse(date);
  if (Number.isNaN(t)) return "";
  return new Date(t).toISOString().slice(0, 10);
}

function isSelfPublished(url: string): boolean {
  const host = hostOf(url);
  return [...HARD_NOISE, ...SELF_PUBLISHED].some((d) => host === d || host.endsWith(`.${d}`));
}

/**
 * Дата публикации, которой можно верить. Приоритет у даты из выдачи Tavily:
 * её вернул поиск, а не модель. Дату, названную моделью, принимаем только
 * если она совпала с выдачей или реально встречается в тексте страницы.
 * Иначе дата остаётся пустой: от неё зависят свежесть и +10 к баллу, и у
 * модели, которой велено искать свежее, есть прямой стимул её подрисовать.
 */
function pageDate(raw: unknown, fromSearch: string | undefined, pageText: string): string {
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
 * Страница-витрина: лента тегов, рубрика, список публикаций. Текста на ней
 * много, цитата с неё находится, и отбор честно говорит «подходит» — но
 * темой она быть не может, у неё нет содержания. Поймал живой прогон:
 * в ленту встала страница «#personalbranding #aiinmarketing … - LinkedIn».
 */
function isFeedPage(title: string, url: string): boolean {
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
function sameUrl(a: string, b: string): boolean {
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

/** Насколько свежая находка — только для порядка открытия страниц. */
function dateRank(date: string | undefined, now: Date): number {
  const days = ageInDays(normalizeDate(date ?? ""), now);
  return days === null ? -1 : 10_000 - days;
}

/** Материал-основание: страница, прошедшая отбор и проверку цитаты кодом. */
interface Material {
  url: string;
  kind: FeedKind;
  title: string;
  summary: string;
  whyNow: string;
  angle: string;
  audienceQuestion: string;
  evidence: string;
  date: string;
  outlet: string;
  facts: string[];
  /** Названия первоисточников, упомянутых на странице. Без адресов. */
  mentions: string[];
  /** Страница материала как источник. Она точно открыта: мы её скачали. */
  source: ResearchSource;
  /** Наблюдаемые признаки. Хранятся, чтобы пересчитать балл, когда станет
   *  известно число подтверждающих страниц: их считает код при сборке темы. */
  signals: CredibilitySignals;
  /** Возраст в днях или null. Нужен для пересчёта балла. */
  days: number | null;
  credibility: ReturnType<typeof scoreCredibility>;
  freshness: ReturnType<typeof freshnessOf>;
  score: number;
}

function parseKind(raw: unknown): FeedKind | null {
  return FEED_KINDS.includes(raw as FeedKind) ? (raw as FeedKind) : null;
}

export interface FeedOptions {
  settings: Settings;
  date: string;
  apiKey?: string;
  searchApiKey?: string;
  now?: Date;
}

export async function* runFeed(opts: FeedOptions): AsyncGenerator<FeedEvent> {
  const { settings, date } = opts;
  const apiKey = opts.apiKey ?? process.env.GEMINI_API_KEY;
  const searchKey = opts.searchApiKey ?? process.env.TAVILY_API_KEY;
  const now = opts.now ?? new Date();

  if (!apiKey) {
    yield { type: "error", message: "Не задан GEMINI_API_KEY. Добавьте его в .env.local и перезапустите npm run dev." };
    return;
  }
  if (!searchKey) {
    yield { type: "error", message: "Не задан TAVILY_API_KEY. Ключ бесплатный: tavily.com → Get API key." };
    return;
  }
  const key = searchKey;

  const client = new GoogleGenAI({ apiKey });
  const model = settings.model;
  const siftOrder = siftRotation(model);
  const startedAt = Date.now();
  let credits = 0;
  let modelCalls = 0;

  let mark = Date.now();
  const lap = () => {
    const s = (Date.now() - mark) / 1000;
    mark = Date.now();
    return s < 10 ? `${s.toFixed(1)} с` : `${Math.round(s)} с`;
  };

  try {
    /* ---------- 1. Повестка дня ---------- */
    yield { type: "step", step: "agenda", status: "running" };
    const memory = await readFeedMemory();
    if (memory.titles.length) {
      yield {
        type: "log",
        kind: "info",
        text: `Помню ${memory.titles.length} прошлых тем и ${memory.urls.size} использованных источников — повторять не буду.`,
      };
    }

    const agenda = await askFast(client, model, {
      system_instruction: buildFeedAgendaSystem(settings, PER_KIND_QUERIES),
      generation_config: { max_output_tokens: 6000, thinking_level: "low" },
      store: false,
      input: [
        `Сегодня ${weekdayRu(date)}, ${date}.`,
        memory.titles.length
          ? `Эти темы уже были — не предлагай запросы, которые снова приведут к ним:\n${memory.titles
              .slice(0, 40)
              .map((t) => `— ${t}`)
              .join("\n")}`
          : "",
        `Составь ${PER_KIND_QUERIES * 3} поисковых запросов — по ${PER_KIND_QUERIES} на каждый тип темы.`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    });
    modelCalls++;

    const rawAgenda = extractJson(agenda.text) as { queries?: unknown };
    const planned: { q: string; kind: FeedKind }[] = [];
    if (Array.isArray(rawAgenda.queries)) {
      for (const item of rawAgenda.queries) {
        if (typeof item !== "object" || item === null) continue;
        const o = item as { q?: unknown; kind?: unknown };
        const q = typeof o.q === "string" ? o.q.trim() : "";
        const kind = parseKind(o.kind);
        if (q && kind) planned.push({ q, kind });
      }
    }
    if (!planned.length) {
      throw new Error(`Модель не предложила ни одного поискового запроса. Начало ответа: ${agenda.text.slice(0, 200)}`);
    }
    yield {
      type: "step",
      step: "agenda",
      status: "done",
      detail: `${planned.length} запросов · ${lap()}`,
    };

    /* ---------- 2. Поиск ---------- */
    yield { type: "step", step: "search", status: "running", detail: `${planned.length} запросов разом` };
    const hits = new Map<string, SearchHit>();
    const used: string[] = [];

    const outcomes = await tavilySearchMany(
      key,
      planned.map((p) => p.q),
      [],
      { timeRange: "month", maxResults: 8, excludeDomains: HARD_NOISE },
    );
    for (const [i, out] of outcomes.entries()) {
      credits += out.credits;
      if (out.error) {
        yield { type: "log", kind: "warn", text: `Запрос не прошёл: ${out.query} — ${out.error}` };
        continue;
      }
      used.push(out.query);
      let fresh = 0;
      for (const hit of out.hits) {
        // Источник, на котором уже стояла тема, второй раз темой не станет.
        if (memory.urls.has(hit.url) || hits.has(hit.url)) continue;
        hits.set(hit.url, hit);
        fresh++;
      }
      const label = FEED_KIND_LABEL[planned[i].kind];
      yield {
        type: "log",
        kind: fresh ? "result" : "warn",
        text: `${label} · «${out.query}» → ${fresh} новых`,
      };
    }

    if (hits.size === 0) {
      yield { type: "step", step: "search", status: "error" };
      yield { type: "error", message: "Поиск не вернул ни одной новой страницы. Проверьте ключ Tavily." };
      return;
    }
    yield { type: "step", step: "search", status: "done", detail: `${hits.size} кандидатов · ${lap()}` };

    /* ---------- 3. Открытие страниц ---------- */
    yield { type: "step", step: "open", status: "running" };
    const candidates = [...hits.values()]
      .sort((a, b) => dateRank(b.publishedDate, now) - dateRank(a.publishedDate, now))
      .slice(0, MAX_OPEN);

    const openLogs: FeedEvent[] = [];
    const opened = await openPages(
      key,
      candidates.map((c) => c.url),
      (kind, text) => {
        openLogs.push({ type: "log", kind, text });
      },
    );
    for (const line of openLogs) yield line;
    credits += opened.credits;

    if (!opened.pages.length) {
      yield { type: "step", step: "open", status: "error" };
      yield { type: "error", message: "Ни одну страницу не удалось открыть — оснований для тем нет." };
      return;
    }
    yield { type: "step", step: "open", status: "done", detail: `${opened.pages.length} страниц · ${lap()}` };

    /* ---------- 4. Отбор оснований ---------- */
    yield { type: "step", step: "select", status: "running" };
    const byUrl = new Map(candidates.map((c) => [c.url, c]));
    const openedUrls = new Set(opened.pages.map((p) => p.url));
    const textByUrl = new Map(opened.pages.map((p) => [p.url, p.text]));
    const siftSys = buildFeedSiftSystem(settings, date);

    const chunks: (typeof opened.pages)[] = [];
    for (let i = 0; i < opened.pages.length; i += SIFT_CHUNK) {
      chunks.push(opened.pages.slice(i, i + SIFT_CHUNK));
    }

    const pageBlock = (p: { url: string; text: string }, i: number) => {
      const hit = byUrl.get(p.url);
      const meta = [
        `URL: ${p.url}`,
        hit?.title ? `Заголовок из выдачи: ${hit.title}` : "",
        hit?.publishedDate ? `Дата из выдачи: ${hit.publishedDate}` : "Дата из выдачи: неизвестна",
      ]
        .filter(Boolean)
        .join("\n");
      return `### Страница ${i + 1}\n${meta}\n\nТЕКСТ:\n${p.text.slice(0, SIFT_CHARS)}`;
    };

    const runChunk = async (chunk: typeof opened.pages, ci: number) => {
      const input = chunk.map(pageBlock).join("\n\n---\n\n");
      const t0 = Date.now();
      // Разбор страниц идёт на Groq: у него суточный лимит на три порядка
      // больше, чем у Gemini, а работа тут механическая — вытащить цитату
      // и факты в JSON. Квота Gemini остаётся написанию контента.
      // Когда пачки идут параллельно, каждая начинает со СВОЕЙ модели: так
      // они не дерутся за одну квоту. Когда по очереди — вращать порядок
      // вредно, каждая обязана начинать с сильнейшей.
      const from = lanes > 1 ? ci % siftOrder.length : 0;
      const order = siftOrder.slice(from).concat(siftOrder.slice(0, from));
      // Причины копим по каждой модели: раньше сохранялась только последняя,
      // и в логе висела жалоба Gemini, хотя до него отказали ещё двое.
      const failures: string[] = [];
      for (const [attempt, ref] of order.slice(0, SIFT_ATTEMPTS).entries()) {
        try {
          const answer = await askRef(client, ref, { system: siftSys, input, maxTokens: 6000 });
          const items = (extractJson(answer.text) as { items?: unknown }).items;
          const via = attempt === 0 ? refLabel(ref) : `${refLabel(order[0])} не ответила → ${refLabel(ref)}`;
          const took = ((Date.now() - t0) / 1000).toFixed(1);
          return { items, error: "", note: `${via}: ${chunk.length} стр. за ${took} с`, calls: attempt + 1 };
        } catch (e) {
          failures.push(`${refLabel(ref)} — ${describeModelError(e)}`);
        }
      }
      return {
        items: undefined,
        error: failures.join(" | "),
        note: "",
        calls: order.slice(0, SIFT_ATTEMPTS).length,
      };
    };

    /*
     * Пачек больше, чем моделей с большой квотой, поэтому запускаем их не
     * все разом, а по числу таких моделей. Запуск всех сразу упирался в
     * лимит Groq на токены в минуту: две пачки уходили одной модели и
     * получали 413. Groq разбирает пачку за секунды, так что вторая волна
     * почти ничего не стоит по времени.
     */
    const lanes = lanesFor(siftOrder);
    const pending = new Map<number, ReturnType<typeof runChunk>>();
    let nextChunk = 0;
    const fill = () => {
      while (pending.size < lanes && nextChunk < chunks.length) {
        const i = nextChunk++;
        pending.set(i, runChunk(chunks[i], i));
      }
    };
    fill();

    const rawItems: unknown[] = [];
    let readyChunks = 0;
    while (pending.size) {
      const [ci, res] = await Promise.race(
        [...pending.entries()].map(([i, p]) => p.then((r) => [i, r] as const)),
      );
      pending.delete(ci);
      readyChunks++;
      modelCalls += res.calls;
      if (res.note) yield { type: "log", kind: "result", text: res.note };
      if (Array.isArray(res.items)) rawItems.push(...res.items);
      else if (res.error) yield { type: "log", kind: "warn", text: `Пачка страниц не разобралась: ${res.error}` };
      yield {
        type: "step",
        step: "select",
        status: "running",
        detail: `${readyChunks} из ${chunks.length} пачек · ${rawItems.length} разобрано`,
      };
      fill();
    }

    /* Проверка кодом: цитата обязана реально быть на странице. */
    const materials: Material[] = [];
    let droppedQuote = 0;
    let droppedFit = 0;
    for (const raw of rawItems) {
      if (typeof raw !== "object" || raw === null) continue;
      const o = raw as Record<string, unknown>;
      const url = typeof o.url === "string" ? o.url.trim() : "";
      if (!url || !openedUrls.has(url)) continue;
      const kind = parseKind(o.kind);
      if (!kind) continue;
      if (o.fit !== "yes") {
        droppedFit++;
        continue;
      }

      const evidence = typeof o.evidence === "string" ? o.evidence.trim() : "";
      const pageText = textByUrl.get(url) ?? "";
      if (!evidenceInText(evidence, pageText)) {
        // Цитаты нет в тексте страницы — значит основание выдумано.
        droppedQuote++;
        continue;
      }

      const hit = byUrl.get(url);
      const pageTitle = ((typeof o.title === "string" && o.title) || hit?.title || "").trim();
      if (isFeedPage(pageTitle, url)) {
        droppedFit++;
        continue;
      }
      // Единственный источник материала — страница, которую мы сами скачали.
      const selfSource: ResearchSource = {
        title: (typeof o.title === "string" && o.title) || hit?.title || hostOf(url),
        url,
        outlet: (typeof o.outlet === "string" && o.outlet) || hostOf(url),
        date: pageDate(o.date, hit?.publishedDate, pageText),
        kind: "publication",
        opened: true,
      };
      const mentions = parseStrings(o.mentions, 4);

      const rawSignals = (o.signals ?? {}) as Partial<CredibilitySignals>;
      const signals: CredibilitySignals = {
        // Первоисточник засчитывается по НАЗВАННОМУ на странице документу,
        // а не по ссылке: ссылку мы всё равно не открывали.
        hasPrimarySource: Boolean(rawSignals.hasPrimarySource) && mentions.length > 0,
        // Подтверждения считает код — по числу других открытых страниц той же
        // темы. Заявление модели тут ничего не стоит: проверить его нечем.
        independentConfirmations: 0,
        peerReviewedOrOfficial: Boolean(rawSignals.peerReviewedOrOfficial),
        outletReputable: Boolean(rawSignals.outletReputable) && !isSelfPublished(url),
        authorKnown: Boolean(rawSignals.authorKnown),
        hasConcreteEvidence: Boolean(rawSignals.hasConcreteEvidence),
        clickbaitMarkers: Boolean(rawSignals.clickbaitMarkers),
        unverifiedClaims: Boolean(rawSignals.unverifiedClaims),
        quoteShowsIntersection: true,
      };
      const normalizedDate = selfSource.date;
      const days = ageInDays(normalizedDate, now);
      const credibility = scoreCredibility(signals, days);
      const freshness = freshnessOf(days);

      materials.push({
        url,
        kind,
        title: selfSource.title.trim(),
        summary: (typeof o.summary === "string" ? o.summary : "").trim(),
        whyNow: (typeof o.whyNow === "string" ? o.whyNow : "").trim(),
        angle: (typeof o.angle === "string" ? o.angle : "").trim(),
        audienceQuestion: (typeof o.audienceQuestion === "string" ? o.audienceQuestion : "").trim(),
        evidence,
        date: normalizedDate,
        outlet: selfSource.outlet,
        facts: parseStrings(o.facts, 4),
        mentions,
        source: selfSource,
        signals,
        days,
        credibility,
        freshness,
        // Свежесть добавляется к достоверности: вчерашний материал при равном
        // балле ценнее полугодового, потому что лента про «что сейчас».
        score: credibility.score + (freshness === "days" ? 12 : freshness === "weeks" ? 8 : freshness === "months" ? 3 : 0),
      });
    }

    if (droppedQuote) {
      yield {
        type: "log",
        kind: "warn",
        text: `Отброшено за ненайденную на странице цитату: ${droppedQuote}. Основание без подтверждения — не основание.`,
      };
    }
    if (droppedFit) {
      yield { type: "log", kind: "info", text: `Не подошли по содержанию: ${droppedFit}.` };
    }

    /* Тройку собирает КОД: по лучшему материалу на каждый тип. */
    const chosen = pickTopics(materials, memory.titles);
    const gotKinds = chosen.map((c) => FEED_KIND_LABEL[c.anchor.kind]);
    yield {
      type: "step",
      step: "select",
      status: "done",
      detail: `${chosen.length} из 3 · ${lap()}`,
    };
    if (chosen.length) {
      yield { type: "log", kind: "info", text: `Темы дня: ${gotKinds.join(" · ")}` };
    }

    if (!chosen.length) {
      yield { type: "step", step: "write", status: "error" };
      yield {
        type: "error",
        message:
          "Ни одна из открытых страниц не дала основания для темы: либо цитаты не подтвердились, либо всё уже было в прошлых лентах. Попробуйте позже — к вечеру появятся новые публикации.",
      };
      return;
    }

    /* ---------- 5. Три формата на каждую тему ---------- */
    yield { type: "step", step: "write", status: "running", detail: `${chosen.length} тем параллельно` };

    const topics: FeedTopic[] = [];
    const writePending = new Map(
      chosen.map((c, i) => [i, writeTopic(client, settings, writeRotation(model, i), c, date)] as const),
    );
    while (writePending.size) {
      const [i, res] = await Promise.race(
        [...writePending.entries()].map(([k, p]) => p.then((r) => [k, r] as const)),
      );
      writePending.delete(i);
      modelCalls += res.calls;
      if (res.topic) {
        topics.push(res.topic);
        yield {
          type: "log",
          kind: "result",
          text: `${FEED_KIND_LABEL[res.topic.kind]} (${res.via}): ${res.topic.title}`,
        };
        yield { type: "topic", topic: res.topic };
      } else {
        yield {
          type: "log",
          kind: "warn",
          text: `Тему «${chosen[i].anchor.title}» написать не удалось: ${res.error}`,
        };
      }
      yield {
        type: "step",
        step: "write",
        status: "running",
        detail: `${topics.length} из ${chosen.length} готово`,
      };
    }

    if (!topics.length) {
      yield { type: "step", step: "write", status: "error" };
      yield { type: "error", message: "Ни одну тему не удалось написать. Скорее всего, исчерпаны квоты моделей." };
      return;
    }

    // Порядок в ленте фиксированный: тренд, экспертное, мнение. Иначе он
    // менялся бы от того, какая тема успела написаться первой.
    topics.sort((a, b) => FEED_KINDS.indexOf(a.kind) - FEED_KINDS.indexOf(b.kind));

    const missing = FEED_KINDS.filter((k) => !topics.some((t) => t.kind === k));
    const shortfall = missing.length
      ? `Сегодня набралось ${topics.length} ${topics.length === 1 ? "тема" : "темы"} вместо трёх. Не нашлось основания для типа: ${missing
          .map((k) => FEED_KIND_LABEL[k].toLowerCase())
          .join(", ")}. Выдумывать недостающую тему я не стал.`
      : "";

    yield { type: "step", step: "write", status: "done", detail: `${topics.length} тем · ${lap()}` };

    const feed: DailyFeed = {
      id: date,
      date,
      weekday: weekdayRu(date),
      createdAt: now.toISOString(),
      topics,
      shortfall,
      queries: used,
      meta: {
        model,
        durationMs: Date.now() - startedAt,
        searches: used.length,
        fetches: opened.pages.length,
        credits,
        modelCalls,
      },
    };
    await saveFeed(feed);
    yield {
      type: "log",
      kind: "info",
      text: `Готово за ${Math.round((Date.now() - startedAt) / 1000)} с · вызовов модели: ${modelCalls} · кредитов Tavily: ${credits}.`,
    };
    yield { type: "done", feed };
  } catch (e) {
    yield { type: "error", message: describeModelError(e) };
  }
}

/** Основной материал темы и материалы, которые её подпирают. */
interface Chosen {
  anchor: Material;
  support: Material[];
}

/**
 * Три темы разных типов выбирает КОД. Это и есть гарантия того, что день
 * не сведётся к трём вариациям одного: на каждый тип берётся ровно один
 * материал, и взять два материала одного типа структурно невозможно.
 *
 * Повтор отсеивается здесь же: по заголовкам прошлых лент. Адреса отсеяны
 * раньше, ещё на выдаче поиска, но заголовок ловит случай, когда то же
 * событие описано другим изданием по другой ссылке.
 */
function pickTopics(materials: Material[], pastTitles: string[]): Chosen[] {
  const isRepeat = (m: Material) => pastTitles.some((t) => titleOverlap(m.title, t) >= REPEAT_OVERLAP);
  const takenHosts = new Set<string>();
  const out: Chosen[] = [];

  for (const kind of FEED_KINDS) {
    const pool = materials
      .filter((m) => m.kind === kind && !isRepeat(m))
      .sort((a, b) => b.score - a.score);
    // Три темы из одного издания — тоже однообразие, просто менее заметное.
    const anchor = pool.find((m) => !takenHosts.has(hostOf(m.url))) ?? pool[0];
    if (!anchor) continue;
    takenHosts.add(hostOf(anchor.url));
    // Подпирают тему только страницы ДРУГИХ изданий: два пересказа одной
    // новости на одном сайте подтверждением друг другу не являются.
    const anchorHost = hostOf(anchor.url);
    const support = materials
      .filter((m) => m.url !== anchor.url && m.kind === kind && hostOf(m.url) !== anchorHost)
      .sort((a, b) => b.score - a.score)
      .slice(0, SUPPORT_PER_TOPIC);
    // Балл пересчитывается здесь: независимые подтверждения — это число
    // РЕАЛЬНО открытых страниц других изданий по той же теме. Считает код,
    // а не модель: её заявление о подтверждениях проверить нечем.
    const scored: Material = {
      ...anchor,
      credibility: scoreCredibility({ ...anchor.signals, independentConfirmations: support.length }, anchor.days),
    };
    out.push({ anchor: scored, support });
  }
  return out;
}

/** Материалы темы в текст для модели. Модель видит только то, что проверено. */
function materialsBlock(chosen: Chosen): string {
  const one = (m: Material, tag: string) =>
    [
      `### ${tag}: ${m.title}`,
      `Издание: ${m.outlet}${m.date ? `, ${m.date}` : ", дата неизвестна"}`,
      `URL: ${m.url}`,
      `Достоверность: ${m.credibility.score} из 100 (${m.credibility.label})`,
      m.summary ? `О чём: ${m.summary}` : "",
      m.whyNow ? `Почему сейчас: ${m.whyNow}` : "",
      m.angle ? `Угол: ${m.angle}` : "",
      m.audienceQuestion ? `Вопрос аудитории: ${m.audienceQuestion}` : "",
      `Дословная цитата со страницы (проверена системой): «${m.evidence}»`,
      m.facts.length ? `Факты со страницы:\n${m.facts.map((f) => `— ${f}`).join("\n")}` : "Конкретных цифр на странице нет.",
      m.mentions.length
        ? `Страница ссылается на первоисточники (только названия; адресов у них нет и ставить их в контент НЕЛЬЗЯ): ${m.mentions.join("; ")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

  return [one(chosen.anchor, "ОСНОВНОЙ МАТЕРИАЛ"), ...chosen.support.map((m) => one(m, "ДОПОЛНИТЕЛЬНО"))].join(
    "\n\n---\n\n",
  );
}

/**
 * Написать три формата для одной темы. Темы пишутся параллельно и каждая
 * на своей модели: три вызова к одной модели подряд стоили бы трёх запросов
 * из одной суточной квоты, а так — по одному из трёх разных.
 */
async function writeTopic(
  client: GoogleGenAI,
  settings: Settings,
  order: ModelRef[],
  chosen: Chosen,
  date: string,
): Promise<{ topic: FeedTopic | null; error: string; calls: number; via: string }> {
  const kind = chosen.anchor.kind;
  const system = buildFeedWriteSystem(settings, kind);
  const input = [
    `Сегодня ${weekdayRu(date)}, ${date}.`,
    `Тип темы: ${FEED_KIND_LABEL[kind]}.`,
    "ПРОВЕРЕННЫЕ МАТЕРИАЛЫ (других источников у тебя нет):",
    materialsBlock(chosen),
    "Напиши тему и три формата. Ссылки в фактах бери ТОЛЬКО из URL выше.",
  ].join("\n\n");

  const failures: string[] = [];
  let calls = 0;
  // Очередь уже собрана под эту тему: две модели Gemini, дальше Groq.
  for (const ref of order) {
    calls++;
    try {
      const answer = await askRef(client, ref, { system, input, maxTokens: 16000 });
      const parsed = FeedTopicDraftSchema.safeParse(extractJson(answer.text));
      if (!parsed.success) {
        failures.push(
          `${refLabel(ref)} — структура: ${parsed.error.issues
            .slice(0, 3)
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ")}`,
        );
        continue;
      }
      const draft = parsed.data;

      // Ссылки в фактах обязаны вести на материалы, которые мы дали модели.
      // Без этой проверки она охотно ставит правдоподобный, но выдуманный URL.
      const pages = [chosen.anchor, ...chosen.support];
      const facts: Fact[] = draft.facts.filter((f) => pages.some((m) => sameUrl(m.url, f.url)));

      return {
        topic: {
          id: `${date}-${kind}`,
          kind,
          title: draft.title.trim(),
          angle: draft.angle.trim(),
          whyNow: draft.whyNow.trim(),
          audienceQuestion: draft.audienceQuestion.trim(),
          facts,
          // Источники темы — все открытые страницы, на которых она стоит.
          sources: pages.map((m) => m.source),
          mentions: [...new Set(pages.flatMap((m) => m.mentions))].slice(0, 6),
          evidence: chosen.anchor.evidence,
          credibility: chosen.anchor.credibility,
          freshness: chosen.anchor.freshness,
          stories: draft.stories,
          carousel: draft.carousel,
          reel: draft.reel,
        },
        error: "",
        calls,
        via: refLabel(ref),
      };
    } catch (e) {
      failures.push(`${refLabel(ref)} — ${describeModelError(e)}`);
    }
  }
  return {
    topic: null,
    error: failures.join(" | ") || "структура ответа не сошлась",
    calls,
    via: "",
  };
}
