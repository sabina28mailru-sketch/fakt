import { GoogleGenAI } from "@google/genai";
import {
  ResearchIntentSchema,
  type Rejected,
  type ResearchEvent,
  type ResearchIntent,
  type ResearchAnswer,
  type ResearchMaterial,
  type ResearchResult,
  type ResearchSource,
  type Settings,
  type SourceKind,
} from "./schema";
import { openLogKind, openPages, tavilySearchMany, type SearchHit } from "./search";
import { ageInDays, freshnessOf, scoreCredibility, type CredibilitySignals } from "./credibility";
import { askFast, askRef, describeModelError, lanesFor, refLabel, siftRotation } from "./model";
import { hostOf } from "./utils";
import { addUsage } from "./store";
import { conceptInText, evidenceInText } from "./text-match";

/**
 * Сколько страниц открываем целиком: судим по тексту, а не по сниппету.
 * Было 14. Каждая лишняя страница удлиняет и открытие, и судейство, а в
 * выдачу дальние кандидаты почти не попадали: сортировка по свежести ставит
 * лучшее в начало. Десять — это пять пачек судейства по две страницы, и все
 * пять идут одновременно, так что лишние страницы почти ничего не стоят
 * по времени: шаг длится столько, сколько самая медленная пачка.
 */
const MAX_OPEN = 10;
/**
 * Сколько знаков страницы уходит на судейство. Полные 12 000 на десять страниц
 * давали 120 000 знаков на один вызов, и шаг не укладывался в лимит маршрута.
 * Для решения «о том ли эта страница» начала текста достаточно, а проверка
 * понятий и цитаты всё равно идёт по полному тексту в коде.
 */
const JUDGE_CHARS = 3500;
/**
 * Сколько запросов уходит в первую волну поиска. Модель предлагает до
 * двенадцати, но десять параллельных запросов по восемь результатов дают
 * больше кандидатов, чем успевает пройти через MAX_OPEN. Остаток держим
 * в резерве на случай, если свежего материала не набралось.
 */
const FIRST_WAVE = 7;
/**
 * Сколько страниц судим одним запросом. Замер показал резкую нелинейность:
 * пачка из четырёх страниц разбиралась 90–144 секунды, из одной — 4 секунды.
 * Время съедает не чтение, а печать JSON: токены на выходе идут подряд.
 * По две страницы на пачку — восемь страниц раскладываются на четыре пачки,
 * по одной на каждую модель из ротации.
 */
const JUDGE_CHUNK = 2;
/**
 * Сколько моделей пробует одна пачка, прежде чем сдаться. Три — потолок,
 * дальше ожидание пользователя дороже двух спасённых страниц.
 */
const JUDGE_ATTEMPTS = 3;
/** Ниже этого числа основных материалов честнее сказать, что темы мало. */
const THIN_RESULT = 3;

const SOCIAL_NOISE = [
  "instagram.com",
  "facebook.com",
  "threads.com",
  "tiktok.com",
  "x.com",
  "twitter.com",
  "pinterest.com",
  "reddit.com",
  "quora.com",
  "youtube.com",
  "linkedin.com",
  "medium.com",
  "dzen.ru",
  "vc.ru",
];

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("Модель ответила не в том формате. Обычно помогает повтор, а если повторяется — другая модель в разделе «Бриф».");
  }
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    // Обрыв по лимиту токенов выглядит именно так: скобки есть, а структура битая.
    throw new Error("Ответ модели оборвался на середине. Стоит повторить прогон.");
  }
}

/* ---------- Шаг 1: точное поисковое намерение ---------- */

function intentSystem(): string {
  return [
    "Ты — поисковый аналитик. Твоя работа — превратить тему пользователя в точное поисковое намерение.",
    "Главное правило: НЕ РАСШИРЯЙ тему. Если пользователь написал «AI для стоматологических клиник», то это пересечение двух понятий: искусственный интеллект И стоматология. Материал только про AI или только про стоматологию теме НЕ соответствует.",
    "concepts — понятия запроса, СГРУППИРОВАННЫЕ по смыслу. Обычно их 2, реже 3. У каждого name (как называть понятие человеку) и variants — способы, которыми оно реально встречается в текстах.",
    "В variants давай ЩЕДРО, 6–10 штук: синонимы, аббревиатуры, английские и русские варианты, близкие по смыслу термины. Скупой список приводит к тому, что подходящие материалы отбраковываются: в статье написано «публичность руководителя», а в вариантах была только «медийность».",
    'Пример для «AI для стоматологических клиник»: [{"name":"искусственный интеллект","variants":["AI","ИИ","artificial intelligence","машинное обучение","нейросеть","алгоритм","computer vision"]},{"name":"стоматология","variants":["dental","dentistry","стоматологическая клиника","зубной врач","стоматолог","ортодонтия","имплантология"]}]',
    "НЕ разбивай синонимы одного понятия на разные группы: иначе страница про одну только стоматологию наберёт два совпадения и пройдёт как соответствующая.",
    "notThis — соседние темы, которые легко подсунуть вместо запрошенной. Перечисли их явно, чтобы потом отбраковывать.",
    "queries — от 8 до 12 поисковых запросов. Покрой разные углы темы: свежие новости, исследования и статистику, официальные публикации, практические кейсы, разборы и мнения профильных экспертов, изменения в индустрии. Формулируй по-разному: один и тот же смысл разными словами находит разные страницы. Каждый запрос обязан удерживать ВСЕ понятия темы, иначе выдача уедет в соседнюю. Пиши так, как набирают в поиске: 3–8 значимых слов, без кавычек и операторов. Если тема русскоязычная — большинство запросов по-русски, два-три по-английски.",
    "В запросы НЕ вставляй годы и слова вроде «2024», «2025»: свежесть задаётся отдельным фильтром, а год в тексте запроса уводит выдачу в старые материалы.",
    'ОТВЕТ — ТОЛЬКО JSON: {"restated":"как ты понял запрос, одно предложение","concepts":[{"name":"…","variants":["…"]}],"notThis":["…"],"queries":["…"]}',
  ].join("\n\n");
}

/* ---------- Шаг 6: сводный ответ по теме ---------- */

function answerSystem(topic: string): string {
  return [
    "Ты — редактор. Тебе даны отобранные материалы по теме пользователя. Собери из них короткий прямой ответ.",
    `ТЕМА: ${topic}`,
    "summary — 2–3 предложения: что по этой теме происходит прямо сейчас, по существу. Без вводных оборотов и без пересказа того, что тема важна.",
    "points — от 3 до 7 конкретных утверждений. В каждом обязательно что-то проверяемое: число, срок, название, изменение. У каждого пункта materialIds — номера материалов в квадратных скобках, из которых взято утверждение. Если утверждение держится на двух материалах, укажи оба.",
    "gaps — чего в найденных материалах нет: какие вопросы остались без ответа, где данные противоречат друг другу. Если всё сходится — пустой массив.",
    "ЖЁСТКО: бери только то, что написано в переданных материалах. Ничего не добавляй из общих знаний, не выдумывай цифр и не обобщай сверх сказанного. Если чего-то в материалах нет — это идёт в gaps, а не в points.",
    'ОТВЕТ — ТОЛЬКО JSON: {"summary":"…","points":[{"text":"…","materialIds":["1","3"]}],"gaps":["…"]}',
  ].join("\n\n");
}

/* ---------- Шаг 4: судейство по тексту открытой страницы ---------- */

function judgeSystem(intent: ResearchIntent, today: string): string {
  return [
    "Ты — редактор-фактчекер. Тебе дан запрос пользователя и тексты страниц, которые система открыла целиком.",
    `Сегодня ${today}.`,
    `ЗАПРОС: ${intent.restated}`,
    [
      "ПОНЯТИЯ ЗАПРОСА (в материале обязаны присутствовать ВСЕ, каждое — хотя бы одним из своих вариантов):",
      ...intent.concepts.map((c) => `— ${c.name}: ${[c.name, ...c.variants].join(", ")}`),
    ].join("\n"),
    intent.notThis.length ? `НЕ ЭТО (соседние темы, не подменять ими запрос): ${intent.notThis.join("; ")}` : "",
    "По каждой странице ответь на три вопроса, опираясь ТОЛЬКО на её текст:",
    "1. Соответствует ли материал теме пользователя?",
    "2. Действительно ли информация в материале относится к запросу, а не просто содержит похожие слова?",
    "3. Есть ли в самом тексте страницы подтверждение этой связи? Приведи дословную цитату.",
    "relation: core — в тексте присутствуют ВСЕ понятия запроса и страница говорит именно об их пересечении. related — присутствует часть понятий, и страница честно связана с темой, но прямым ответом не является. off — не соответствует.",
    "Примеры для запроса «AI для стоматологических клиник»: страница стоматологии с прайсом на лечение зубов, где про AI ничего нет, — это off, а не core. Страница про ИИ в медицине вообще, без стоматологии, — тоже off. Страница про ИИ-диагностику по снимкам зубов — core.",
    "Если не можешь привести дословную цитату со страницы, подтверждающую связь, — ставь off. Совпадение ключевых слов без содержательной связи не считается соответствием.",
    "evidence — цитата строго из текста страницы, без изменений. Ничего не сочиняй: ни цитат, ни дат, ни ссылок.",
    "date — дата публикации в формате ГГГГ-ММ-ДД, если она есть в тексте или передана в метаданных. Если даты нет — пустая строка. Выдумывать дату запрещено.",
    "facts — до четырёх конкретных фактов с этой страницы: числа, выборки, названия, сроки. Только то, что реально написано на странице. Если материал не соответствует теме (relation: off), facts, summary, whyNow и sources оставляй пустыми — они всё равно не понадобятся.",
    "sources — ссылки ТОЛЬКО из числа страниц, переданных тебе в этом сообщении. Адреса, которых в списке нет, система отбросит: при скачивании ссылки вырезаются вместе с разметкой, и проверить их нечем. Восстанавливать адрес по памяти запрещено — выдуманная ссылка рядом с настоящей цитатой хуже, чем её отсутствие. Нет подходящих — пустой массив.",
    "signals — наблюдаемые признаки для оценки надёжности. Отвечай честно, это не оценка качества материала, а фиксация фактов о нём.",
    "ОТВЕТ — ТОЛЬКО JSON:",
    `{"items":[{"url":"адрес страницы как он дан","relation":"core|related|off","reason":"почему именно так","relationNote":"для related — чем связано","evidence":"дословная цитата","title":"заголовок материала","summary":"1–2 предложения о чём материал","whyNow":"почему это актуально сейчас","date":"ГГГГ-ММ-ДД или пусто","outlet":"название издания","facts":["…"],"sources":[{"title":"…","url":"адрес ТОЛЬКО из числа переданных тебе страниц; чужих адресов по памяти не приводи","outlet":"…","kind":"primary|research|official|publication"}],"signals":{"hasPrimarySource":false,"independentConfirmations":0,"peerReviewedOrOfficial":false,"outletReputable":false,"authorKnown":false,"hasConcreteEvidence":false,"clickbaitMarkers":false,"unverifiedClaims":false}}]}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

interface JudgedItem {
  url: string;
  relation: string;
  reason?: string;
  relationNote?: string;
  evidence?: string;
  title?: string;
  summary?: string;
  whyNow?: string;
  date?: string;
  outlet?: string;
  facts?: unknown;
  sources?: unknown;
  signals?: Partial<CredibilitySignals>;
}

const SOURCE_KINDS: SourceKind[] = ["primary", "research", "official", "publication"];

function parseSources(raw: unknown, pageUrls: Set<string>): ResearchSource[] {
  if (!Array.isArray(raw)) return [];
  const out: ResearchSource[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const s = item as Record<string, unknown>;
    const url = typeof s.url === "string" ? s.url.trim() : "";
    if (!url || !/^https?:\/\//i.test(url)) continue;
    const kind = SOURCE_KINDS.includes(s.kind as SourceKind) ? (s.kind as SourceKind) : "publication";
    out.push({
      title: typeof s.title === "string" && s.title ? s.title : hostOf(url),
      url,
      outlet: typeof s.outlet === "string" && s.outlet ? s.outlet : hostOf(url),
      date: typeof s.date === "string" ? s.date : "",
      kind,
      opened: pageUrls.has(url),
    });
  }
  return out;
}

function parseStrings(raw: unknown, limit: number): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, limit);
}

export interface ResearchOptions {
  topic: string;
  settings: Settings;
  apiKey?: string;
  searchApiKey?: string;
  now?: Date;
}

/**
 * Исследование произвольной темы. Отличие от конвейера выпуска — в дисциплине
 * соответствия: материал попадает в основную выдачу только если модель смогла
 * привести дословную цитату со страницы, подтверждающую связь с запросом.
 * Всё остальное уходит в «связанные» или в отбраковку с указанием причины.
 */
export async function* runResearch(opts: ResearchOptions): AsyncGenerator<ResearchEvent> {
  const topic = opts.topic.trim();
  const apiKey = opts.apiKey ?? process.env.GEMINI_API_KEY;
  const searchKey = opts.searchApiKey ?? process.env.TAVILY_API_KEY;
  const now = opts.now ?? new Date();

  if (!topic) {
    yield { type: "error", message: "Пустая тема: введите, что искать." };
    return;
  }
  if (!apiKey) {
    yield { type: "error", message: "Не задан GEMINI_API_KEY. Добавьте его в .env.local и перезапустите npm run dev." };
    return;
  }
  if (!searchKey) {
    yield { type: "error", message: "Не задан TAVILY_API_KEY. Ключ бесплатный: tavily.com → Get API key." };
    return;
  }

  const client = new GoogleGenAI({ apiKey });
  const model = opts.settings.model;
  let credits = 0;

  /**
   * Секундомер по шагам. Без него «долго» — это ощущение, а не факт:
   * понять, чем заняты минуты (моделью, поиском или медленными сайтами),
   * по крутящемуся индикатору нельзя.
   */
  const started = Date.now();
  let mark = started;
  const lap = () => {
    const s = (Date.now() - mark) / 1000;
    mark = Date.now();
    return s < 10 ? `${s.toFixed(1)} с` : `${Math.round(s)} с`;
  };

  try {
    /* ---------- 1. Намерение ---------- */
    yield { type: "step", step: "intent", status: "running" };
    // Разложить запрос на понятия — работа не для флагманской модели.
    // На lite она идёт быстрее и берётся из другой суточной квоты, так что
    // 20 запросов флагмана целиком остаются судейству — единственному шагу,
    // которому действительно нужно рассуждать по длинному тексту.
    const intentAnswer = await askFast(client, model, {
      system_instruction: intentSystem(),
      // 3000 не хватало: рассуждения тоже идут в выходные токены, и JSON обрывался
      // на середине — разбор молча получал объект без queries.
      generation_config: { max_output_tokens: 8000, thinking_level: "low" },
      store: false,
      input: `Тема пользователя: ${topic}`,
    });

    const rawIntent = extractJson(intentAnswer.text) as Record<string, unknown>;
    let concepts = parseConcepts(rawIntent.concepts, rawIntent.mustInclude);
    if (concepts.length === 0) {
      concepts = conceptsFromTopic(topic);
      yield {
        type: "log",
        kind: "warn",
        text: "Модель не разложила запрос на понятия — ищу по теме целиком, проверка соответствия будет мягче.",
      };
    }
    const parsedIntent = ResearchIntentSchema.safeParse({
      restated: typeof rawIntent.restated === "string" ? rawIntent.restated : topic,
      concepts,
      mustInclude: concepts.map((c) => c.name),
      notThis: parseStrings(rawIntent.notThis, 8),
    });
    if (!parsedIntent.success) throw new Error("Не удалось разобрать поисковое намерение");
    const intent = parsedIntent.data;
    const queries = parseStrings(rawIntent.queries, 12);
    if (!queries.length) {
      throw new Error(
        "Модель не предложила ни одного поискового запроса. Стоит повторить прогон.",
      );
    }

    yield { type: "log", kind: "info", text: `Понял так: ${intent.restated}` };
    if (intent.mustInclude.length) {
      yield { type: "log", kind: "info", text: `Обязательно вместе: ${intent.mustInclude.join(" + ")}` };
    }
    yield { type: "step", step: "intent", status: "done", detail: `${queries.length} запросов · ${lap()}` };

    /* ---------- 2. Поиск: от свежего к более старому ---------- */
    yield { type: "step", step: "search", status: "running" };
    const hits = new Map<string, SearchHit>();
    const used: string[] = [];
    // Отдельная переменная, потому что объявление функции поднимается выше
    // проверки ключа и сужение типа до неё не доезжает.
    const key = searchKey;

    /**
     * Одна волна: запросы уходят параллельно и возвращаются пачкой.
     * Раньше цикл шёл по одному запросу за раз, и двенадцать запросов по
     * несколько секунд складывались в минуты ожидания на ровном месте —
     * при том что запросы друг от друга не зависят вовсе.
     */
    async function wave(batch: string[], range: "month" | "year") {
      const outcomes = await tavilySearchMany(key, batch, [], {
        timeRange: range,
        maxResults: 8,
        excludeDomains: SOCIAL_NOISE,
      });
      const lines: ResearchEvent[] = [];
      for (const out of outcomes) {
        credits += out.credits;
        if (out.error) {
          lines.push({ type: "log", kind: "warn", text: `Запрос не прошёл: ${out.query} — ${out.error}` });
          continue;
        }
        used.push(out.query);
        let fresh = 0;
        for (const hit of out.hits) {
          if (hits.has(hit.url)) continue;
          hits.set(hit.url, hit);
          fresh++;
        }
        // Без перечня доменов: каждый источник и так показан в результате
        // ссылкой, а здесь четыре адреса на строку превращали лог в стену.
        lines.push({
          type: "log",
          kind: fresh ? "result" : "warn",
          text: fresh ? `«${out.query}» → ${fresh} новых` : `«${out.query}» → ничего нового`,
        });
      }
      return lines;
    }

    const first = queries.slice(0, FIRST_WAVE);
    yield { type: "log", kind: "search", text: `Ищу за ${rangeLabel("month")}: ${first.length} запросов параллельно` };
    yield { type: "step", step: "search", status: "running", detail: `${first.length} запросов разом` };
    for (const line of await wave(first, "month")) yield line;

    // Вторая волна — только если свежего материала не набралось. Чаще всего
    // первой хватает, и тогда второй заход не тратит ни времени, ни кредитов.
    if (hits.size < MAX_OPEN) {
      const rest = queries.slice(FIRST_WAVE);
      const batch = rest.length ? rest : first;
      const range = rest.length ? "month" : "year";
      yield {
        type: "log",
        kind: "search",
        text: `Кандидатов мало (${hits.size}) — расширяю: ${rangeLabel(range)}, ещё ${batch.length} запросов`,
      };
      yield { type: "step", step: "search", status: "running", detail: "расширяю охват" };
      for (const line of await wave(batch, range)) yield line;
    }

    if (hits.size === 0) {
      yield { type: "step", step: "search", status: "error" };
      yield {
        type: "error",
        message: `По теме «${topic}» поиск не вернул ничего. Проверьте формулировку или ключ Tavily.`,
      };
      return;
    }
    yield { type: "step", step: "search", status: "done", detail: `${hits.size} кандидатов · ${lap()}` };

    /* ---------- 3. Открываем страницы ---------- */
    yield { type: "step", step: "open", status: "running" };
    // Сначала то, у чего есть дата и она свежее: судить по сниппету нельзя,
    // но порядок открытия выбирать по нему можно.
    const candidates = [...hits.values()]
      .sort((a, b) => dateRank(b.publishedDate, now) - dateRank(a.publishedDate, now))
      .slice(0, MAX_OPEN);

    const logs: ResearchEvent[] = [];
    const opened = await openPages(searchKey, candidates.map((c) => c.url), (kind, text) => {
      logs.push({ type: "log", kind: openLogKind(kind), text });
    });
    for (const log of logs) yield log;
    credits += opened.credits;

    if (!opened.pages.length) {
      yield { type: "step", step: "open", status: "error" };
      yield {
        type: "error",
        message: "Ни одну страницу не удалось открыть — судить о соответствии теме не по чему.",
      };
      return;
    }
    yield { type: "step", step: "open", status: "done", detail: `${opened.pages.length} страниц · ${lap()}` };

    /* ---------- 4. Судейство ---------- */
    yield { type: "step", step: "judge", status: "running" };
    const byUrl = new Map(candidates.map((c) => [c.url, c]));
    const pageUrls = new Set(opened.pages.map((p) => p.url));
    const textByUrl = new Map(opened.pages.map((p) => [p.url, p.text]));

    const pageBlock = (p: { url: string; text: string }, i: number) => {
      const hit = byUrl.get(p.url);
      const meta = [
        `URL: ${p.url}`,
        hit?.title ? `Заголовок из выдачи: ${hit.title}` : "",
        hit?.publishedDate ? `Дата из выдачи: ${hit.publishedDate}` : "Дата из выдачи: неизвестна",
      ]
        .filter(Boolean)
        .join("\n");
      return `### Страница ${i + 1}\n${meta}\n\nТЕКСТ:\n${p.text.slice(0, JUDGE_CHARS)}`;
    };

    /**
     * Судейство пачками и параллельно. Одним запросом на все страницы модель
     * писала многотысячный JSON подряд, и шаг занимал 138 секунд из 178 —
     * почти весь прогон. Токены на выходе печатаются последовательно, поэтому
     * единственный способ ускорить — писать несколько ответов сразу.
     *
     * Пачки уходят на РАЗНЫЕ flash-модели. На бесплатном тарифе суточная квота
     * считается отдельно по каждой модели, так что три пачки — это по одному
     * запросу из трёх разных карманов, а не три из одного: скорость растёт,
     * а число прогонов в сутки не падает.
     */
    const chunks: (typeof opened.pages)[] = [];
    for (let i = 0; i < opened.pages.length; i += JUDGE_CHUNK) {
      chunks.push(opened.pages.slice(i, i + JUDGE_CHUNK));
    }
    const rotation = siftRotation(model);
    const judgeSys = judgeSystem(intent, now.toISOString().slice(0, 10));

    yield {
      type: "step",
      step: "judge",
      status: "running",
      detail: `${chunks.length} ${chunks.length === 1 ? "пачка" : "пачки"} параллельно`,
    };

    const runChunk = async (chunk: typeof opened.pages, ci: number) => {
      const input = `Тема пользователя: ${topic}\n\n${chunk.map(pageBlock).join("\n\n---\n\n")}`;
      const t0 = Date.now();
      const took = () => `${((Date.now() - t0) / 1000).toFixed(1)} с`;

      // Пачка начинает со своей модели и, если та не ответила, спускается по
      // очереди дальше. Впереди стоит Groq: суточная квота там на порядки
      // больше, а работа механическая — вытащить цитату и факты в JSON.
      // Терять уже открытые страницы из-за выбранной квоты нельзя: поиск
      // за них уже оплачен.
      const from = judgeLanes > 1 ? ci % rotation.length : 0;
      const order = rotation.slice(from).concat(rotation.slice(0, from));
      let lastError = "";
      for (const [attempt, ref] of order.slice(0, JUDGE_ATTEMPTS).entries()) {
        try {
          const answer = await askRef(client, ref, { system: judgeSys, input, maxTokens: 5000 });
          const items = (extractJson(answer.text) as { items?: unknown }).items;
          const via = attempt === 0 ? refLabel(ref) : `${refLabel(order[0])} не ответила → ${refLabel(ref)}`;
          return { items, error: "", note: `${via}: ${chunk.length} стр. за ${took()}` };
        } catch (e) {
          lastError = describeModelError(e);
        }
      }
      return { items: undefined, error: lastError, note: "" };
    };

    // Промежуточные результаты отдаём по мере готовности, а не все разом в
    // конце. Пачки всё равно идут параллельно, но раньше шаг молчал две
    // минуты и выглядел зависшим — теперь видно, что работа идёт.
    /*
     * Через Groq пачки идут по очереди: лимит там считается в токенах за
     * минуту и общий на ключ, поэтому одновременный запуск его же и пробивает.
     * Скорость это почти не съедает — пачка разбирается за секунды.
     */
    const judgeLanes = lanesFor(rotation);
    const pending = new Map<number, ReturnType<typeof runChunk>>();
    let nextChunk = 0;
    const fillJudge = () => {
      while (pending.size < judgeLanes && nextChunk < chunks.length) {
        const i = nextChunk++;
        pending.set(i, runChunk(chunks[i], i));
      }
    };
    fillJudge();
    const items: unknown[] = [];
    let readyChunks = 0;
    while (pending.size) {
      const [ci, res] = await Promise.race(
        [...pending.entries()].map(([i, p]) => p.then((r) => [i, r] as const)),
      );
      pending.delete(ci);
      readyChunks++;
      if (res.note) yield { type: "log", kind: "tech", text: res.note };
      if (Array.isArray(res.items)) items.push(...res.items);
      else if (res.error) yield { type: "log", kind: "warn", text: `Пачка страниц не разобралась: ${res.error}` };
      yield {
        type: "step",
        step: "judge",
        status: "running",
        detail: `${readyChunks} из ${chunks.length} пачек · ${items.length} разобрано`,
      };
      fillJudge();
    }
    if (!items.length) throw new Error("Судейство не вернуло ни одного разобранного материала");
    const rawJudged = { items };
    yield { type: "step", step: "judge", status: "done", detail: `${items.length} разобрано · ${lap()}` };

    /* ---------- 5. Оценка надёжности ---------- */
    yield { type: "step", step: "answer", status: "running" };
    const materials: ResearchMaterial[] = [];
    const rejected: Rejected[] = [];

    for (const raw of rawJudged.items as JudgedItem[]) {
      if (typeof raw !== "object" || raw === null) continue;
      const url = typeof raw.url === "string" ? raw.url.trim() : "";
      if (!url || !pageUrls.has(url)) continue; // ссылку, которой мы не открывали, в выдачу не пускаем

      const hit = byUrl.get(url);
      const title = (raw.title || hit?.title || hostOf(url)).trim();
      const relation = raw.relation === "core" ? "core" : raw.relation === "related" ? "related" : "off";
      const evidence = typeof raw.evidence === "string" ? raw.evidence.trim() : "";

      // Наличие понятия — механический факт, его устанавливает код по тексту страницы.
      // Раньше требовалось, чтобы модель дословно повторила длинное название понятия
      // («медийность и публичность»), а она возвращала короткое — и подходящие
      // материалы отбраковывались все до одного.
      const pageText = textByUrl.get(url) ?? "";
      const found = intent.concepts.filter((c) => conceptInText(c, pageText));
      const missing = intent.concepts.filter((c) => !found.includes(c));
      const quoteReal = evidenceInText(evidence, pageText);
      // Раньше для основной выдачи требовалось, чтобы ВСЕ понятия сошлись внутри
      // одной цитаты. Для узкого запроса это работало, а для рассуждающей темы
      // («как медийность влияет на бизнес») одна фраза почти никогда не содержит
      // обе стороны сразу — и в основную выдачу не попадало ничего.
      // Теперь это признак уверенности, а не условие.
      const quoteShowsAll = intent.concepts.every((c) => conceptInText(c, evidence));

      // Решает код, а не модель: в основную выдачу попадает только материал,
      // где найдены ВСЕ понятия запроса и есть дословная цитата со страницы.
      // Иначе страница про одну лишь стоматологию проходила бы как «AI в стоматологии».
      const relationByCode: "core" | "related" | "off" =
        !evidence || !quoteReal || found.length === 0
          ? "off"
          : missing.length === 0
            ? relation === "off"
              ? "off"
              : relation
            : "related";

      if (relationByCode === "off") {
        rejected.push({
          title,
          url,
          // Сначала причина кода: раньше здесь стояло объяснение модели, и в
          // списке отбракованных висели фразы вида «материал прямо разбирает
          // тему» — читалось так, будто подходящее выбросили без причины.
          // Если модель сама признала материал неподходящим, показываем её довод:
          // «нет цитаты» в этом случае — следствие, а не причина.
          reason:
            relation === "off"
              ? raw.reason?.trim() || "материал не соответствует теме"
              : !evidence
                ? "не удалось подтвердить связь с темой цитатой со страницы"
                : !quoteReal
                  ? "приведённая цитата не найдена в тексте страницы"
                  : `на странице нет понятий темы: ${intent.concepts.map((c) => c.name).join(", ")}`,
        });
        continue;
      }

      const codeRelationNote =
        relationByCode !== "related"
          ? ""
          : missing.length > 0
            ? `На странице есть «${found.map((c) => c.name).join(", ")}», но нет «${missing.map((c) => c.name).join(", ")}» — это соседняя тема, а не прямой ответ.`
            : "";

      const date = typeof raw.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? raw.date : hit?.publishedDate ?? "";
      const normalizedDate = normalizeDate(date);
      const days = ageInDays(normalizedDate, now);
      /*
       * Только те источники, чьи страницы мы реально скачивали.
       *
       * Раньше сюда проходили адреса, названные моделью, — и рисовались
       * кликабельными ссылками. Но htmlToText вырезает ссылки вместе с
       * разметкой ещё при скачивании, значит взять URL со страницы модель
       * не могла: она восстанавливала его по памяти. Правдоподобный
       * выдуманный адрес рядом с настоящей цитатой — ровно то, что
       * запрещено правилами проекта, и он ещё поднимал балл на +20.
       *
       * Та же правка уже сделана в ленте; разная строгость в соседних
       * разделах — это не гибкость, а лазейка.
       */
      const sources = parseSources(raw.sources, pageUrls).filter((s) => pageUrls.has(s.url));

      const signals: CredibilitySignals = {
        hasPrimarySource: Boolean(raw.signals?.hasPrimarySource) && sources.some((s) => s.kind !== "publication"),
        // Подтверждение без ссылки проверить нельзя, поэтому счёт ограничен
        // числом реально приведённых источников.
        independentConfirmations: Math.min(
          Math.max(0, Math.min(10, Number(raw.signals?.independentConfirmations) || 0)),
          sources.length,
        ),
        peerReviewedOrOfficial: Boolean(raw.signals?.peerReviewedOrOfficial),
        outletReputable: Boolean(raw.signals?.outletReputable) && !isSelfPublished(url),
        authorKnown: Boolean(raw.signals?.authorKnown),
        hasConcreteEvidence: Boolean(raw.signals?.hasConcreteEvidence),
        clickbaitMarkers: Boolean(raw.signals?.clickbaitMarkers),
        unverifiedClaims: Boolean(raw.signals?.unverifiedClaims),
        quoteShowsIntersection: quoteShowsAll,
      };

      materials.push({
        id: `${materials.length + 1}`,
        title,
        summary: (raw.summary || "").trim() || "Краткое содержание со страницы извлечь не удалось.",
        whyNow: (raw.whyNow || "").trim(),
        facts: parseStrings(raw.facts, 8),
        date: normalizedDate,
        outlet: (raw.outlet || hostOf(url)).trim(),
        url,
        relation: relationByCode,
        relationNote: (raw.relationNote || "").trim() || codeRelationNote,
        evidence,
        conceptsFound: found.map((c) => c.name),
        sources,
        confirmations: signals.independentConfirmations,
        credibility: scoreCredibility(signals, days),
        freshness: freshnessOf(days),
      });
    }

    // Основные материалы вперёд, внутри — по надёжности, потом по свежести.
    materials.sort((a, b) => {
      if (a.relation !== b.relation) return a.relation === "core" ? -1 : 1;
      if (b.credibility.score !== a.credibility.score) return b.credibility.score - a.credibility.score;
      return (b.date || "").localeCompare(a.date || "");
    });

    const core = materials.filter((m) => m.relation === "core");
    const shortfall =
      core.length === 0
        ? `По теме «${topic}» не нашлось ни одного материала, который бы ей прямо соответствовал. Ниже — только связанные материалы; подменять ими запрос я не стал.`
        : core.length < THIN_RESULT
          ? `По теме «${topic}» нашлось всего ${core.length} подходящих ${core.length === 1 ? "материал" : "материала"}. Остальное отбраковано как не соответствующее запросу — списком ниже.`
          : "";

    yield {
      type: "step",
      step: "answer",
      status: "done",
      detail: `${core.length} по теме, ${materials.length - core.length} связанных`,
    };
    /* ---------- 6. Сводный ответ по теме ---------- */
    // Лента ссылок отвечает «что нашлось», но не «что из этого следует».
    // Ответ собирается ТОЛЬКО из отобранных материалов и ссылается на их id.
    let answer: ResearchAnswer = { summary: "", points: [], gaps: [] };
    if (core.length > 0) {
      const brief = core
        .slice(0, 8)
        .map(
          (m) =>
            `[${m.id}] ${m.title} (${m.outlet}${m.date ? `, ${m.date}` : ""})
О чём: ${m.summary}
Факты: ${m.facts.join("; ") || "конкретных чисел нет"}`,
        )
        .join("\n\n");
      try {
        // Тоже на lite: материалы уже отобраны и проверены кодом, здесь нужно
        // только аккуратно пересказать своими словами то, что в них написано.
        const written = await askFast(client, model, {
          system_instruction: answerSystem(topic),
          generation_config: { max_output_tokens: 6000, thinking_level: "low" },
          store: false,
          input: `Тема: ${topic}

ОТОБРАННЫЕ МАТЕРИАЛЫ:

${brief}`,
        });
        const rawAnswer = extractJson(written.text) as Record<string, unknown>;
        const ids = new Set(core.map((m) => m.id));
        const points = Array.isArray(rawAnswer.points)
          ? (rawAnswer.points as Record<string, unknown>[])
              .filter((pt) => pt && typeof pt.text === "string" && pt.text.trim())
              .map((pt) => ({
                text: String(pt.text).trim(),
                // Ссылаться можно только на материалы этого же результата.
                materialIds: parseStrings(pt.materialIds, 6).filter((id) => ids.has(id)),
              }))
              .slice(0, 7)
          : [];
        answer = {
          summary: typeof rawAnswer.summary === "string" ? rawAnswer.summary.trim() : "",
          points,
          gaps: parseStrings(rawAnswer.gaps, 4),
        };
      } catch (e) {
        // Ответ — надстройка над лентой: если он не собрался, лента остаётся.
        yield { type: "log", kind: "warn", text: `Сводный ответ собрать не удалось: ${describeModelError(e)}` };
      }
    }

    // Кошелёк Tavily общий с лентой и выпуском — считаем в одном месте.
    const monthly = await addUsage({ tavilyCredits: credits });
    yield {
      type: "log",
      kind: "info",
      text:
        `Готово за ${Math.round((Date.now() - started) / 1000)} с · кредитов Tavily: ${credits}. ` +
        `За месяц: ${monthly.tavilyCredits} кредитов, ${monthly.runs} прогонов.`,
    };

    const result: ResearchResult = {
      id: `${now.toISOString().slice(0, 19).replace(/[:T]/g, "-")}`,
      topic,
      createdAt: now.toISOString(),
      intent,
      materials,
      answer,
      rejected,
      queries: used,
      credits,
      shortfall,
    };

    yield { type: "done", result };
  } catch (e) {
    yield { type: "error", message: describeModelError(e) };
  }
}

/**
 * Понятия запроса с синонимами. Модель возвращает их то объектами, то просто
 * строками, то под старым именем mustInclude — разбираем все формы, потому что
 * падать на разборе ответа из-за формы дороже, чем принять её как есть.
 */
function parseConcepts(raw: unknown, fallback: unknown): { name: string; variants: string[] }[] {
  const out: { name: string; variants: string[] }[] = [];
  const push = (name: string, variants: string[]) => {
    const clean = name.trim();
    if (!clean || out.length >= 4) return;
    if (out.some((c) => c.name.toLowerCase() === clean.toLowerCase())) return;
    out.push({ name: clean, variants });
  };

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === "string") push(item, []);
      else if (item && typeof item === "object") {
        const c = item as Record<string, unknown>;
        const name = typeof c.name === "string" ? c.name : typeof c.concept === "string" ? c.concept : "";
        const variants =
          typeof c.variants === "string" ? [c.variants] : parseStrings(c.variants ?? c.synonyms, 12);
        if (name) push(name, variants);
      }
    }
  }

  // Старое имя поля: модель иногда отвечает по прежней схеме.
  if (out.length === 0 && Array.isArray(fallback)) {
    for (const item of fallback) if (typeof item === "string") push(item, []);
  }
  return out;
}

/**
 * Запасные понятия из самой темы: делим на значимые слова. Строгость гейта
 * при этом ниже, но лучше провести поиск и честно сказать об этом, чем
 * отказать пользователю из-за формы ответа модели.
 */
function conceptsFromTopic(topic: string): { name: string; variants: string[] }[] {
  const words = topic
    .split(/[^A-Za-zА-Яа-яЁё0-9]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 4);
  if (!words.length) return [{ name: topic.trim(), variants: [] }];
  return [{ name: topic.trim(), variants: words }];
}

/**
 * Площадки, где «издание» — это сам автор материала: соцсети, блог-платформы
 * и собственные сайты компаний. Репутация издания к ним неприменима.
 */
function isSelfPublished(url: string): boolean {
  const host = hostOf(url);
  return SOCIAL_NOISE.some((d) => host === d || host.endsWith(`.${d}`));
}

function rangeLabel(range: "week" | "month" | "year"): string {
  return range === "week" ? "последние дни" : range === "month" ? "последний месяц" : "последний год";
}

/** Насколько свежая находка — только для порядка открытия страниц. */
function dateRank(date: string | undefined, now: Date): number {
  const days = ageInDays(normalizeDate(date ?? ""), now);
  if (days === null) return -1;
  return 10_000 - days;
}

/** Tavily отдаёт дату в разных форматах; приводим к ГГГГ-ММ-ДД или к пустой строке. */
function normalizeDate(date: string): string {
  if (!date) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const t = Date.parse(date);
  if (Number.isNaN(t)) return "";
  return new Date(t).toISOString().slice(0, 10);
}
