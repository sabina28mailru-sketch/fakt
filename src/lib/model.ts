import { ApiError, GoogleGenAI, type Interactions } from "@google/genai";

/**
 * Общий доступ к модели для конвейера выпуска и для исследования темы.
 * Без стриминга: инструментов у модели нет, показывать по ходу нечего,
 * зато ошибки приходят с HTTP-статусом, а не теряются в оборванном потоке.
 */

export type ModelParams = Interactions.CreateModelInteractionParamsNonStreaming;

export interface ModelAnswer {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Статус ответа, если он вообще доехал: на потоковых вызовах SDK его теряет. */
export function statusOf(e: unknown): number | undefined {
  if (typeof e === "object" && e !== null && "status" in e) {
    const status = (e as { status?: unknown }).status;
    if (typeof status === "number") return status;
  }
  return undefined;
}

/**
 * Суточная квота кончилась. Google помечает это в quotaId словом PerDay,
 * и повтор тут бессмыслен: лимит вернётся не через секунды, а в полночь
 * по тихоокеанскому времени. Раньше код этого не различал и честно ждал
 * столько, сколько просило API, — пользователь смотрел на крутящийся
 * первый шаг пять минут и получал ровно ту же ошибку, что в первую секунду.
 */
export function isDailyQuota(e: unknown): boolean {
  const text = e instanceof Error ? e.message : String(e);
  return /per[\s_-]?day/i.test(text);
}

/** Повторять стоит только то, что может пройти со второго раза: обрывы сети, минутный 429 и 5xx. */
function worthRetry(e: unknown): boolean {
  if (isDailyQuota(e)) return false;
  const status = statusOf(e);
  // 413 у Groq означает не «запрос слишком длинный навсегда», а превышение
  // лимита токенов в минуту: через несколько секунд тот же запрос проходит.
  if (status !== undefined) return status === 429 || status === 413 || status >= 500;
  return true; // без статуса — значит запрос вообще не дошёл
}

/** API сам пишет, через сколько можно повторить («Please retry in 7s») — это точнее любого бэкоффа. */
function retryAfterMs(e: unknown): number | null {
  const text = e instanceof Error ? e.message : String(e);
  const m =
    text.match(/retry in (\d+(?:\.\d+)?)\s*s/i) ??
    text.match(/try again in (\d+(?:\.\d+)?)\s*s/i) ??
    text.match(/retryDelay"?\s*:\s*"?(\d+(?:\.\d+)?)s/i);
  return m ? Math.ceil(Number(m[1]) * 1000) + 500 : null;
}

/**
 * Дольше этого ждать в интерактивном запросе нельзя: человек сидит перед
 * спиннером. Если API просит паузу больше — отдаём ошибку сразу, с ней
 * хотя бы понятно, что делать (сменить модель), а не просто «грузится».
 */
const MAX_WAIT_MS = 12_000;

/**
 * Сеть здесь рвётся регулярно, а один оборвавшийся вызов стоит всей работы:
 * к этому моменту уже потрачены поиски и кредиты. Отдельно важен 429 —
 * у бесплатного тарифа есть и минутный лимит, который проходит сам за несколько секунд.
 */
export async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (i === tries - 1 || !worthRetry(e)) break;
      const wait = retryAfterMs(e) ?? 1500 * (i + 1);
      if (wait > MAX_WAIT_MS) break;
      await sleep(wait);
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

export async function askModel(client: GoogleGenAI, params: ModelParams): Promise<ModelAnswer> {
  const res = await withRetry(() => client.interactions.create({ ...params, stream: false }));
  return {
    text: res.output_text ?? "",
    inputTokens: res.usage?.total_input_tokens ?? 0,
    outputTokens: res.usage?.total_output_tokens ?? 0,
  };
}

/**
 * Лёгкая модель для вспомогательных шагов. На бесплатном тарифе квота
 * считается ОТДЕЛЬНО по каждой модели, и у lite она на порядок больше,
 * чем 20 запросов в сутки у флагманской. Разложить запрос на понятия и
 * собрать сводку из уже отобранных материалов — работа не для флагмана:
 * lite делает её и быстрее, и не из того же кармана.
 */
export const FAST_MODEL = "gemini-3.1-flash-lite";

/**
 * Модели одного класса для параллельной работы. Смысл в том, что на
 * бесплатном тарифе суточная квота считается ОТДЕЛЬНО по каждой модели:
 * четыре пачки на четырёх моделях стоят по одному запросу из четырёх
 * разных карманов, а не четыре из одного. Класс один (flash), поэтому
 * строгость разбора между пачками не расходится.
 */
export const FLASH_MODELS = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash"];

/**
 * Ротация, начинающаяся с выбранной пользователем модели. Его выбор из
 * брифа обязан идти первым, остальные — запасные карманы квоты.
 */
export function rotationFor(model: string): string[] {
  return [model, ...FLASH_MODELS.filter((m) => m !== model)];
}

/**
 * Вызов на лёгкой модели с откатом на основную. Откат нужен, потому что
 * список моделей у Google меняется: если lite недоступна (404) или её квота
 * тоже выбрана, шаг обязан пройти, а не уронить весь прогон.
 */
export async function askFast(
  client: GoogleGenAI,
  fallbackModel: string,
  params: Omit<ModelParams, "model">,
): Promise<ModelAnswer> {
  if (fallbackModel === FAST_MODEL) return askModel(client, { ...params, model: FAST_MODEL });
  try {
    return await askModel(client, { ...params, model: FAST_MODEL });
  } catch {
    return askModel(client, { ...params, model: fallbackModel });
  }
}

const DAY_QUOTA_HINT =
  "Суточная квота этой модели исчерпана. На бесплатном тарифе лимит считается отдельно по каждой модели " +
  `(у флагманских — 20 запросов в сутки, у ${FAST_MODEL} — на порядок больше). ` +
  "Смените модель в разделе «Бриф» — у соседней квота своя и, скорее всего, цела. Текущие лимиты: ai.dev/rate-limit";

const MINUTE_QUOTA_HINT =
  "Модель упёрлась в минутный лимит бесплатного тарифа. Подождите минуту и повторите — " +
  "суточная квота при этом не тронута.";

export function describeModelError(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const status = statusOf(e);
  const text = e.message;

  // Провайдеров теперь несколько, и совет «смените модель в разделе Бриф»
  // относится только к Gemini. Для Groq он был бы ложным следом: там
  // ограничение минутное и проходит само.
  if (/qwen|gpt-oss/i.test(text)) {
    if (status === 429 || status === 413) return `Groq, минутный лимит: ${text}`;
    return `Groq не ответил: ${text}`;
  }

  if (status === 401 || status === 403 || (status === 400 && /api[\s_-]?key/i.test(text))) {
    return `Ключ API не принят. Проверьте GEMINI_API_KEY в .env.local. Ответ API: ${text}`;
  }
  if (status === 429 || /too_many_requests|exceeded your current quota|RESOURCE_EXHAUSTED/i.test(text)) {
    // Минутный лимит проходит сам, суточный — нет. Совет обязан их различать:
    // «подождите минуту» при выбранной суточной квоте отправляет ждать впустую.
    return isDailyQuota(e) || !/per[\s_-]?minute/i.test(text) ? DAY_QUOTA_HINT : MINUTE_QUOTA_HINT;
  }
  if (status === 404) return `Модель не найдена (404). Смените модель в разделе «Бриф». Ответ API: ${text}`;
  if (e instanceof ApiError === false && /unusable|fetch failed|ECONNRESET|timeout/i.test(text)) {
    return `Сеть оборвалась: ${text}. Повторы уже встроены — если повторяется, проверьте подключение.`;
  }
  if (status) return `Ошибка API (${status}): ${text}`;
  return text;
}

/* ══════════════════════════════════════════════════════════════════
   Провайдеры моделей.

   Смысл второго провайдера — не «больше моделей», а снятие главного
   ограничения. У Gemini на бесплатном тарифе 20 запросов в сутки НА
   КАЖДУЮ модель; у Groq — тысячи. Поэтому механическая работа (разбор
   страниц на JSON) уходит туда целиком, а квота Gemini остаётся тому,
   ради чего она нужна: русскому тексту голосом владельца.

   Groq говорит на протоколе OpenAI, поэтому один адаптер ниже покроет
   и любого следующего провайдера того же протокола (Cerebras, Mistral,
   OpenRouter) — добавится строка в PROVIDERS и ключ в .env.local.
   ══════════════════════════════════════════════════════════════════ */

export type Provider = "gemini" | "groq";

export interface ModelRef {
  provider: Provider;
  model: string;
}

export interface AskInput {
  system: string;
  input: string;
  maxTokens: number;
}

/**
 * Модели Groq, проверенные на ДОСЛОВНОЕ цитирование русского текста.
 * Это не украшение списка: наш код сверяет цитату с текстом страницы и
 * отбрасывает материал, если её там нет. Модель, которая пересказывает
 * своими словами, тратит вызов впустую.
 *
 * Проверка живым запросом: gpt-oss-120b и qwen3.8-27b цитируют дословно,
 * а gpt-oss-20b переписала «считают» в «считаются» и обрезала фразу —
 * её здесь нет намеренно.
 *
 * Порядок не случаен. gpt-oss-120b стабильно берёт пачку из четырёх страниц
 * за 6–7 секунд, а qwen на том же объёме отвечает 429 даже после повторов:
 * у него на бесплатном тарифе заметно меньше токенов в минуту. Поэтому
 * рабочая лошадь — первая, вторая идёт запасной на случай её отказа.
 */
export const GROQ_MODELS = ["openai/gpt-oss-120b", "qwen/qwen3.8-27b"];

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

export function hasGroq(): boolean {
  return Boolean(process.env.GROQ_API_KEY);
}

/** Запрос к провайдеру протокола OpenAI. */
async function askOpenAiCompatible(url: string, apiKey: string, model: string, p: AskInput): Promise<ModelAnswer> {
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: p.system },
        { role: "user", content: p.input },
      ],
      max_tokens: p.maxTokens,
      // Низкая температура: здесь нужен разбор и точная цитата, а не выдумка.
      temperature: 0.3,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    // Статус кладём в объект: describeModelError читает его так же, как у Gemini.
    // 413 у Groq — не «слишком длинный запрос» вообще, а лимит на токены
    // в минуту. Формулировка провайдера сбивает с толку, поясняем.
    const what = res.status === 413 ? "упёрлась в лимит токенов в минуту" : `ответила ${res.status}`;
    const err = new Error(`${model} ${what}: ${body}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  return {
    text: data.choices?.[0]?.message?.content ?? "",
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
  };
}

/**
 * Вызов модели по ссылке на провайдера. Повторы и разбор ошибок общие:
 * снаружи разница между Gemini и Groq не видна, и вызывающему коду не
 * приходится знать, чья сейчас очередь.
 */
export async function askRef(client: GoogleGenAI, ref: ModelRef, p: AskInput): Promise<ModelAnswer> {
  if (ref.provider === "groq") {
    const key = process.env.GROQ_API_KEY;
    if (!key) throw new Error("Не задан GROQ_API_KEY");
    return withRetry(() => askOpenAiCompatible(GROQ_URL, key, ref.model, p));
  }
  return askModel(client, {
    model: ref.model,
    system_instruction: p.system,
    generation_config: { max_output_tokens: p.maxTokens, thinking_level: "low" },
    store: false,
    input: p.input,
  });
}

/** Как называть модель человеку в логе: провайдер важен, префикс пути — нет. */
export function refLabel(ref: ModelRef): string {
  return ref.provider === "groq" ? `groq/${ref.model.split("/").pop()}` : ref.model;
}

/**
 * Очередь для РАЗБОРА страниц. Groq впереди: у него суточный лимит на три
 * порядка больше, а на замере пачка разбиралась секунды вместо минут.
 * Gemini остаётся в хвосте на случай, если ключа Groq нет или он отказал.
 */
export function siftRotation(model: string): ModelRef[] {
  const groq: ModelRef[] = hasGroq() ? GROQ_MODELS.map((m) => ({ provider: "groq" as const, model: m })) : [];
  return [...groq, ...rotationFor(model).map((m) => ({ provider: "gemini" as const, model: m }))];
}

/**
 * Сколько моделей в начале очереди имеют большую квоту. Пачки распределяются
 * по кругу ИМЕННО по ним: иначе третья пачка уходила на Gemini и падала на
 * исчерпанной квоте, хотя у Groq лимит и не думал кончаться.
 */
export function abundantCount(refs: ModelRef[]): number {
  const n = refs.filter((r) => r.provider === "groq").length;
  return n > 0 ? n : refs.length;
}

/**
 * Сколько пачек можно запускать одновременно. У Groq лимит считается в
 * токенах за минуту и ОБЩИЙ на ключ, поэтому две пачки разом его пробивают:
 * на замере одна проходила за 6 секунд, а вторая получала 429. Когда работа
 * идёт через Groq, пачки выстраиваются в очередь — он настолько быстрее,
 * что три пачки подряд всё равно занимают около двадцати секунд против
 * двух-четырёх минут, которые тот же отбор занимал на Gemini.
 */
export function lanesFor(refs: ModelRef[]): number {
  return refs[0]?.provider === "groq" ? 1 : Math.max(1, refs.length);
}

/**
 * Очередь для НАПИСАНИЯ контента. Здесь порядок обратный: русский текст
 * голосом владельца пишет Gemini, и только когда его суточная квота
 * кончится, тема уходит на Groq — лучше другой стиль, чем ничего.
 */
export function writeRotation(model: string, index = 0): ModelRef[] {
  const gemini = rotationFor(model).map((m) => ({ provider: "gemini" as const, model: m }));
  // Каждая тема начинает со СВОЕЙ модели Gemini: три темы пишутся
  // параллельно, и три запроса подряд к одной модели стоили бы трёх
  // из одной суточной квоты вместо одного из трёх разных карманов.
  const start = index % gemini.length;
  const mine = gemini.slice(start).concat(gemini.slice(0, start));
  const groq: ModelRef[] = hasGroq() ? GROQ_MODELS.map((m) => ({ provider: "groq" as const, model: m })) : [];
  // Берём только две модели Gemini, дальше сразу Groq. Раньше очередь была
  // из четырёх Gemini, и при выбранной квоте первая тема до Groq просто
  // не доходила: четыре попытки заканчивались до запасного провайдера.
  return [...mine.slice(0, 2), ...groq];
}
