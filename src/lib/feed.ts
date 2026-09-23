import { GoogleGenAI } from "@google/genai";
import {
  FEED_KINDS,
  FeedTopicDraftSchema,
  type Concept,
  type DailyFeed,
  type FeedGap,
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
import { conceptInText, evidenceInText, titleOverlap, words } from "./text-match";
import {
  hasConcreteNumbers,
  isFeedPage,
  isOfficialOrResearch,
  looksClickbait,
  normalizeDate,
  pageDate,
  sameUrl,
} from "./page-guards";
import { checkNumbers, firstPersonClaims } from "./numbers";
import { addUsage, readFeed, readFeedMemory, saveFeed } from "./store";
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
 * Сколько понятий ниши должно найтись в тексте страницы, чтобы она вообще
 * считалась материалом для этой ленты.
 *
 * Раньше соответствие нише решала ТОЛЬКО модель полем fit: yes — и это было
 * единственное место в ленте, где не было кодовой проверки. В разделе
 * «Выпуск» поиск ограничен списками изданий из брифа, а лента ищет по всему
 * вебу, так что положиться было не на что вовсе.
 *
 * Два, а не одно: одно понятие ловит любую страницу, где мимоходом сказано
 * «личный бренд». Два требуют, чтобы материал был про пересечение — про то,
 * чем аудитория занимается И где она это делает.
 */
const NICHE_MIN = 2;
/**
 * Насколько заголовок подтверждающего материала должен совпадать с темой.
 * Ниже порога это не подтверждение, а соседний материал того же типа:
 * на живом прогоне статья про модели доступа к информации «подтверждалась»
 * постом про B2B-атрибуцию, и две его строки дошли до слайдов карусели.
 * Порог мягче, чем у защиты от повторов: там ищут совпадение, здесь —
 * родство.
 */
const SUPPORT_OVERLAP = 0.3;

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


function isSelfPublished(url: string): boolean {
  const host = hostOf(url);
  return [...HARD_NOISE, ...SELF_PUBLISHED].some((d) => host === d || host.endsWith(`.${d}`));
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
  /**
   * Полный текст скачанной страницы. Держим при материале, потому что
   * сверять цифры готового контента больше не с чем: факты и цитата —
   * это пересказ модели, а единственная твёрдая опора — сама страница.
   */
  text: string;
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
  /**
   * Какие типы тем собирать. Пусто — все три. Заданы — только они, а темы
   * остальных типов берутся из уже сохранённой ленты этого дня.
   *
   * Это «добрать тему»: когда один тип остался пустым, пересобирать всю
   * ленту значило бы выбросить две готовые темы и потратить втрое больше
   * квоты ради одной недостающей.
   */
  kinds?: FeedKind[];
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

  const wanted = opts.kinds?.length ? FEED_KINDS.filter((k) => opts.kinds!.includes(k)) : FEED_KINDS;
  const topUp = wanted.length < FEED_KINDS.length;
  // Уже собранная лента этого дня: при доборе её темы других типов остаются.
  const existing = topUp ? await readFeed(date) : null;

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

    const rawAgenda = extractJson(agenda.text) as { queries?: unknown; niche?: unknown };
    const niche = parseNiche(rawAgenda.niche, settings);
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
    // При доборе ищем только по нужным типам: остальные запросы стоили бы
    // кредитов Tavily впустую. Если модель не дала ни одного запроса нужного
    // типа, оставляем что есть — лучше искать шире, чем не искать вовсе.
    const forKinds = planned.filter((p) => wanted.includes(p.kind));
    const queries = forKinds.length ? forKinds : planned;
    yield {
      type: "log",
      kind: "info",
      text: `Понятия ниши, по которым буду проверять страницы: ${niche.map((c) => c.name).join(" · ")}`,
    };
    yield {
      type: "step",
      step: "agenda",
      status: "done",
      detail: `${queries.length} запросов · ${lap()}`,
    };

    /* ---------- 2. Поиск ---------- */
    yield { type: "step", step: "search", status: "running", detail: `${queries.length} запросов разом` };
    const hits = new Map<string, SearchHit>();
    const used: string[] = [];

    const outcomes = await tavilySearchMany(
      key,
      queries.map((p) => p.q),
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
      const label = FEED_KIND_LABEL[queries[i].kind];
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
    const droppedNiche: { title: string; found: string[] }[] = [];
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

      // Соответствие нише устанавливает КОД по тексту страницы, а не модель
      // своим fit: yes. Без этого лента, которая ищет по всему вебу, целиком
      // держалась на доверии к одному полю.
      const nicheHits = niche.filter((c) => conceptInText(c, pageText));
      if (nicheHits.length < NICHE_MIN) {
        droppedNiche.push({ title: pageTitle || hostOf(url), found: nicheHits.map((c) => c.name) });
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
        // Названный автор: для мнения это главная опора балла, поэтому
        // признак берётся у модели и здесь же ограничивается — у страницы
        // без автора его быть не может.
        // Первоисточник засчитывается по НАЗВАННОМУ на странице документу,
        // а не по ссылке: ссылку мы всё равно не открывали.
        hasPrimarySource: Boolean(rawSignals.hasPrimarySource) && mentions.length > 0,
        // Подтверждения считает код — по числу других открытых страниц той же
        // темы. Заявление модели тут ничего не стоит: проверить его нечем.
        independentConfirmations: 0,
        // +10 за научность подтверждается доменом: заявление модели об этом
        // стоило десять баллов и не проверялось ничем.
        peerReviewedOrOfficial: Boolean(rawSignals.peerReviewedOrOfficial) && isOfficialOrResearch(url),
        outletReputable: Boolean(rawSignals.outletReputable) && !isSelfPublished(url),
        authorKnown: Boolean(rawSignals.authorKnown),
        // Конкретику определяет код по тексту: «в материале есть числа» —
        // это наблюдаемый факт, а не мнение.
        hasConcreteEvidence: hasConcreteNumbers(pageText),
        // Штраф больше не самодонос: явный кликбейт код видит сам.
        clickbaitMarkers: Boolean(rawSignals.clickbaitMarkers) || looksClickbait(pageTitle),
        unverifiedClaims: Boolean(rawSignals.unverifiedClaims),
        quoteShowsIntersection: true,
      };
      const normalizedDate = selfSource.date;
      const days = ageInDays(normalizedDate, now);
      // Для колонки-мнения балл считается по другим правилам: см. ScoreOptions.
      const credibility = scoreCredibility(signals, days, { opinion: kind === "opinion" });
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
        text: pageText,
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
    if (droppedNiche.length) {
      yield {
        type: "log",
        kind: "info",
        text:
          `Мимо ниши: ${droppedNiche.length}. Нужно минимум ${NICHE_MIN} понятия из «${niche.map((c) => c.name).join(", ")}», ` +
          `а нашлось меньше. Например: ${droppedNiche
            .slice(0, 2)
            .map((d) => `«${d.title.slice(0, 50)}» (${d.found.length ? d.found.join(", ") : "ни одного"})`)
            .join("; ")}.`,
      };
    }

    // Сколько материалов каждого типа пережило проверки. Нужно, чтобы
    // отличить «не нашлось вовсе» от «нашлось, но это повтор».
    const materialsByKind = new Map<FeedKind, number>();
    for (const m of materials) materialsByKind.set(m.kind, (materialsByKind.get(m.kind) ?? 0) + 1);
    // Ошибки написания по типам: «кончилась квота» и «нечего писать» —
    // разные беды, и человеку они говорят разное.
    const writeErrors = new Map<FeedKind, string>();

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
        writeErrors.set(chosen[i].anchor.kind, res.error);
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

    /*
     * При доборе темы других типов берутся из уже сохранённой ленты. Слияние
     * идёт ДО проверки на пустоту: иначе неудачный добор одного типа ронял бы
     * весь прогон ошибкой, хотя две готовые темы лежат на диске и никуда
     * не делись.
     */
    if (existing) {
      const kept = existing.topics.filter((t) => !wanted.includes(t.kind));
      if (kept.length) {
        topics.push(...kept);
        yield { type: "log", kind: "info", text: `Сохранил из сегодняшней ленты: ${kept.length} готовых тем.` };
      }
    }

    if (!topics.length) {
      yield { type: "step", step: "write", status: "error" };
      yield {
        type: "error",
        message:
          "Ни одну тему не удалось написать. Чаще всего это исчерпанные квоты моделей — в логе выше написано, какая именно отказала.",
      };
      return;
    }

    // Порядок в ленте фиксированный: тренд, экспертное, мнение. Иначе он
    // менялся бы от того, какая тема успела написаться первой.
    topics.sort((a, b) => FEED_KINDS.indexOf(a.kind) - FEED_KINDS.indexOf(b.kind));

    const missing = FEED_KINDS.filter((k) => !topics.some((t) => t.kind === k));
    const gaps = buildGaps(missing, materialsByKind, writeErrors);
    const shortfall = missing.length
      ? `Сегодня набралось ${topics.length} ${topics.length === 1 ? "тема" : "темы"} вместо трёх. Выдумывать недостающие я не стал — почему их нет, написано под каждым пустым типом.`
      : "";

    yield { type: "step", step: "write", status: "done", detail: `${topics.length} тем · ${lap()}` };

    const feed: DailyFeed = {
      id: date,
      date,
      weekday: weekdayRu(date),
      createdAt: now.toISOString(),
      topics,
      shortfall,
      gaps,
      niche,
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
    // Кошелёк общий на три конвейера: считаем в одном месте, иначе остаток
    // невозможно увидеть до того, как поиск откажет.
    const spent = await addUsage({ tavilyCredits: credits, modelCalls });
    yield {
      type: "log",
      kind: "info",
      text:
        `Готово за ${Math.round((Date.now() - startedAt) / 1000)} с · вызовов модели: ${modelCalls} · ` +
        `кредитов Tavily: ${credits}. За месяц: ${spent.tavilyCredits} кредитов, ${spent.runs} прогонов.`,
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
      .filter(
        (m) =>
          m.url !== anchor.url &&
          m.kind === kind &&
          hostOf(m.url) !== anchorHost &&
          // И, главное, про ТО ЖЕ САМОЕ. Раньше проверялись только тип и
          // домен, и статья про модели доступа к информации «подтверждалась»
          // постом про B2B-атрибуцию: чужие факты уходили и в балл, и в
          // источники, и прямо в слайды карусели.
          titleOverlap(anchor.title, m.title) >= SUPPORT_OVERLAP,
      )
      .sort((a, b) => b.score - a.score)
      .slice(0, SUPPORT_PER_TOPIC);
    // Балл пересчитывается здесь: независимые подтверждения — это число
    // РЕАЛЬНО открытых страниц других изданий по той же теме. Считает код,
    // а не модель: её заявление о подтверждениях проверить нечем.
    const scored: Material = {
      ...anchor,
      credibility: scoreCredibility({ ...anchor.signals, independentConfirmations: support.length }, anchor.days, {
        opinion: anchor.kind === "opinion",
      }),
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

  const pages = [chosen.anchor, ...chosen.support];
  const allowedUrls = pages.map((m) => m.url);

  const failures: string[] = [];
  let calls = 0;
  /**
   * Тема, у которой всё на месте, кроме фактов с проверенными ссылками.
   * Держим её про запас: если следующая модель справится лучше — берём ту,
   * если нет — отдаём эту, а не теряем оплаченную работу целиком.
   */
  let withoutFacts: FeedTopic | null = null;
  let withoutFactsVia = "";
  /** Что не подтвердилось на прошлой попытке — уходит в промпт повтора. */
  let lastUnverified: string[] = [];

  // Очередь уже собрана под эту тему: две модели Gemini, дальше Groq.
  for (const [attempt, ref] of order.entries()) {
    calls++;
    try {
      // На повторе называем допустимые адреса списком: самая частая причина
      // потери фактов не в том, что модель их выдумала, а в том, что она
      // переписала ссылку по памяти вместо копирования из материалов.
      const thisInput =
        attempt === 0
          ? input
          : [
              input,
              `ВАЖНО: в поле url у каждого факта должен стоять ОДИН ИЗ ЭТИХ адресов, скопированный посимвольно:\n${allowedUrls
                .map((u) => `— ${u}`)
                .join("\n")}\nЛюбой другой адрес будет отброшен, и факт пропадёт.`,
              // Повтору называем причину дословно: без неё модель повторяет
              // ту же выдумку, и лишний вызов уходит впустую.
              lastUnverified.length
                ? `Предыдущая попытка не прошла проверку. Система сверяет КАЖДУЮ цифру в кадрах, слайдах и репликах с текстом открытых страниц и не нашла вот этого:\n${lastUnverified
                    .map((u) => `— ${u}`)
                    .join(
                      "\n",
                    )}\nБери только те числа, которые стоят в материалах выше. Не вычисляй новых: доли, разы и проценты, которых на странице нет, считаются выдумкой. И не пиши от первого лица о встречах, поездках и событиях — система не знает, где владелец был и с кем виделся.`
                : "",
            ]
              .filter(Boolean)
              .join("\n\n");
      const answer = await askRef(client, ref, { system, input: thisInput, maxTokens: 16000 });
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
      const facts: Fact[] = draft.facts.filter((f) => pages.some((m) => sameUrl(m.url, f.url)));

      /*
       * Сверка готового контента со страницами. Это главная проверка в ленте,
       * и добавлена она после настоящего провала: в кадр ушло «рост в
       * 3,7-кратном темпе» — числа нет ни на странице, ни в фактах, ни в
       * цитате, — и «я вернулся с конференции в Алматы», где владелец не был.
       * Запрет на это стоит в промпте прямым текстом и доказанно не держит,
       * поэтому проверяет код по тексту скачанных страниц.
       */
      const parts = [
        ...draft.stories.frames.map((f) => ({ where: `сторис, кадр ${f.n}`, text: f.text })),
        ...draft.carousel.slides.map((sl) => ({ where: `карусель, слайд ${sl.n}`, text: `${sl.title} ${sl.body}` })),
        { where: "карусель, подпись", text: draft.carousel.caption },
        { where: "рилс, хук", text: draft.reel.hook },
        ...draft.reel.script.map((l, n) => ({ where: `рилс, реплика ${n + 1}`, text: l.text })),
        { where: "рилс, подпись", text: draft.reel.caption },
      ];
      const pageTexts = pages.map((m) => m.text);
      const badNumbers = checkNumbers(parts, pageTexts);
      const badClaims = firstPersonClaims(parts);
      const unverified = [
        ...badNumbers.map((b) => `${b.where}: числа ${b.value} нет ни на одной открытой странице`),
        ...badClaims.map((b) => `${b.where}: «${b.value}…» — система не может знать, что это было`),
      ];

      const topic: FeedTopic = {
        unverified,
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
      };

      /*
       * Модель написала факты, но все их ссылки отбракованы — значит она
       * переписала адреса по памяти. Это поправимо: пробуем следующую модель
       * со списком допустимых адресов. Готовую тему держим про запас, чтобы
       * не потерять её, если лучше уже не выйдет.
       */
      /*
       * Выдуманная цифра или рассказ о несуществующем событии — повод
       * переписать тему на другой модели, а не отдать как есть. Попытка
       * стоит одного вызова, а цена пропуска — пост с выдуманной
       * статистикой и настоящей ссылкой рядом.
       */
      const spoiled = facts.length === 0 && draft.facts.length > 0;
      if ((unverified.length > 0 || spoiled) && attempt < order.length - 1) {
        if (unverified.length) {
          failures.push(`${refLabel(ref)} — не подтвердилось: ${unverified.slice(0, 2).join("; ")}`);
        }
        if (spoiled) failures.push(`${refLabel(ref)} — все ${draft.facts.length} фактов сослались не на те страницы`);
        lastUnverified = unverified;
        // Лучший из неудачных вариантов держим про запас: если следующая
        // модель справится хуже или откажет, отдадим этот — с честной
        // пометкой, а не потеряем оплаченную работу целиком.
        if (!withoutFacts || unverified.length < withoutFacts.unverified.length) {
          withoutFacts = topic;
          withoutFactsVia = refLabel(ref);
        }
        continue;
      }

      return { topic, error: "", calls, via: refLabel(ref) };
    } catch (e) {
      failures.push(`${refLabel(ref)} — ${describeModelError(e)}`);
    }
  }

  // Лучше не вышло — отдаём то, что есть. Тема без проверяемых цифр всё
  // равно стоит на открытом источнике и подтверждённой цитате, а интерфейс
  // скажет прямо, что цифр в ней нет.
  if (withoutFacts) {
    return { topic: withoutFacts, error: "", calls, via: withoutFactsVia };
  }
  return {
    topic: null,
    error: failures.join(" | ") || "структура ответа не сошлась",
    calls,
    via: "",
  };
}

/**
 * Понятия ниши из ответа модели. Форма у неё плавает — то объекты, то строки,
 * — поэтому разбираем обе, а падать на разборе дороже, чем принять как есть.
 */
function parseNiche(raw: unknown, settings: Settings): Concept[] {
  const out: Concept[] = [];
  const push = (name: string, variants: string[]) => {
    const clean = name.trim();
    if (!clean || out.length >= 6) return;
    if (out.some((c) => c.name.toLowerCase() === clean.toLowerCase())) return;
    out.push({ name: clean, variants: variants.filter((v) => v.trim().length > 1).slice(0, 12) });
  };

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === "string") push(item, []);
      else if (item && typeof item === "object") {
        const c = item as Record<string, unknown>;
        const name = typeof c.name === "string" ? c.name : "";
        if (name) push(name, parseStrings(c.variants ?? c.synonyms, 12));
      }
    }
  }
  return out.length ? out : nicheFromBrief(settings);
}

/**
 * Запасной словарь ниши — из самого брифа. Нужен, когда модель не вернула
 * понятия: без словаря гейт пропускал бы всё подряд, и лента снова держалась
 * бы на одном доверии. Берём частые значимые слова из тех полей брифа, где
 * владелец описывает свою нишу, и считаем каждое отдельным понятием.
 */
function nicheFromBrief(settings: Settings): Concept[] {
  const b = settings.brief;
  const text = [b.persona, b.topicRules, b.priorities].join(" ");
  const counts = new Map<string, number>();
  for (const w of words(text)) {
    if (w.length < 5) continue;
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  const top = [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b2) => b2[1] - a[1])
    .slice(0, 5)
    .map(([w]) => w);
  return top.map((w) => ({ name: w, variants: [] }));
}

/**
 * Почему тип темы остался пустым. Формулировку пишет КОД по своим счётчикам:
 * «не нашлось материала» и «кончилась квота» требуют от человека разных
 * действий, и подменять одно другим нельзя.
 */
function buildGaps(
  missing: FeedKind[],
  materialsByKind: Map<FeedKind, number>,
  writeErrors: Map<FeedKind, string>,
): FeedGap[] {
  return missing.map((kind) => {
    const err = writeErrors.get(kind);
    if (err) {
      const quota = /квота|лимит|429|413/i.test(err);
      return {
        kind,
        reason: quota
          ? "Материал нашёлся, но написать не удалось: кончилась квота модели. Стоит повторить — тексты пишутся на нескольких моделях, и у соседней квота своя."
          : `Материал нашёлся, но написать не удалось: ${err.slice(0, 160)}`,
        retryable: true,
      };
    }
    const found = materialsByKind.get(kind) ?? 0;
    if (found > 0) {
      return {
        kind,
        reason:
          "Материал этого типа нашёлся, но он повторяет тему из прошлых лент. Подставлять повтор я не стал.",
        retryable: true,
      };
    }
    return {
      kind,
      reason:
        "Сегодня не нашлось ни одной страницы этого типа, которая прошла бы проверку: нужны понятия вашей ниши в тексте и дословная цитата, подтверждённая на самой странице.",
      retryable: true,
    };
  });
}
