import { ApiError, GoogleGenAI, type Interactions } from "@google/genai";
import {
  FAST_MODEL,
  queueForSize,
  refLabel,
  type ModelRef,
} from "./rotation";

// Выбор моделей живёт в rotation.ts и переэкспортируется отсюда:
// вызывающему коду незачем знать, что это два файла, а тесту важно,
// что чистую логику можно собрать без клиента Gemini.
export * from "./rotation";

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

export interface AskInput {
  system: string;
  input: string;
  maxTokens: number;
}

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

/** Запрос к провайдеру протокола OpenAI. */
async function askOpenAiCompatible(url: string, apiKey: string, model: string, p: AskInput): Promise<ModelAnswer> {
  const wantsJson = /json/i.test(p.system) || /json/i.test(p.input);
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
      /*
       * Режим JSON включается, только если о JSON просит сам промпт.
       *
       * Groq отвергает запрос с 400, если response_format задан, а слова
       * «json» в сообщениях нет: «messages must contain the word json in
       * some form». Раньше режим стоял всегда, и шаги, которым нужна проза
       * — заметки ресерча и сверка фактов, — падали на ровном месте.
       * Проверка по тексту промпта совпадает с требованием провайдера
       * буквально, поэтому и флага снаружи не нужно.
       */
      ...(wantsJson ? { response_format: { type: "json_object" } } : {}),
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

/**
 * Спросить первую модель из очереди, которая ответит.
 *
 * Один и тот же цикл перебора был написан трижды — в ленте, в судействе
 * и при написании темы, — а в разделе «Выпуск» его не было вовсе: все пять
 * вызовов шли на одну модель, и кончившаяся у неё суточная квота роняла
 * весь прогон на первом же шаге.
 *
 * Возвращает ещё и то, кто ответил: когда стиль текста вдруг другой,
 * человек должен видеть причину, а не гадать.
 */
export async function askFirstAvailable(
  client: GoogleGenAI,
  order: ModelRef[],
  p: AskInput,
  // Пять: четыре flash плюс замыкающая lite. Меньше — и запасная модель
  // с самой большой квотой до дела не доходит.
  attempts = 5,
): Promise<{ answer: ModelAnswer; via: string; calls: number; failures: string[] }> {
  const failures: string[] = [];
  let calls = 0;
  // Запрос, который Groq заведомо не возьмёт, к нему и не отправляем.
  const queue = queueForSize(order, p.system.length + p.input.length);
  for (const ref of queue.slice(0, Math.max(1, attempts))) {
    calls++;
    try {
      const answer = await askRef(client, ref, p);
      return { answer, via: refLabel(ref), calls, failures };
    } catch (e) {
      failures.push(`${refLabel(ref)} — ${describeModelError(e)}`);
    }
  }
  /*
   * Когда отказали ВСЕ — человеку нужен не список жалоб, а понимание,
   * что делать. Список остаётся ниже, но первым идёт вывод.
   */
  const allQuota = failures.length > 1 && failures.every((f) => /квота|лимит/i.test(f));
  if (allQuota) {
    throw new Error(
      `Свободных моделей не осталось: квота кончилась у всех ${failures.length}, которые были в очереди. ` +
        `Суточные лимиты сбрасываются в полночь по тихоокеанскому времени. Прогон ничего не потратил зря — ` +
        `поиск и открытые страницы не оплачиваются моделями. Подробности: ${failures.join(" | ")}`,
    );
  }
  throw new Error(failures.join(" | ") || "Ни одна модель не ответила.");
}
