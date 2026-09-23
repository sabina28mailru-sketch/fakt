import { GoogleGenAI } from "@google/genai";
import {
  EditionDraftSchema,
  type Edition,
  type PipelineEvent,
  type Settings,
} from "./schema";
import {
  buildPickUrlsSystem,
  buildQueriesSystem,
  buildResearchSystem,
  buildVerifySystem,
  buildWriteSystem,
  usedTopicsBlock,
} from "./brief";
import {
  askFirstAvailable,
  describeModelError,
  geminiRotation,
  siftRotation,
  writeRotation,
  type ModelAnswer,
} from "./model";
import { createQuotaNotice } from "./quota-notice";
import { openLogKind, openPages, tavilySearch, type SearchHit } from "./search";
import { BUCKETS, type SourceBucket } from "./sources";
import { addUsage, nextEditionId, saveEdition } from "./store";
import { verifyEdition } from "./verify-edition";
import { formatDateRu, hostOf, rubricIndex, weekdayRu } from "./utils";

type Answer = ModelAnswer;

const TIME_RANGES = ["week", "month", "year"] as const;
type TimeRange = (typeof TIME_RANGES)[number];

interface PlannedQuery {
  q: string;
  bucket: SourceBucket;
  recency: TimeRange;
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("В ответе модели нет JSON-объекта");
  return JSON.parse(candidate.slice(start, end + 1));
}

/** Разобрать план поиска. Что не разобралось — отбрасываем, а не угадываем. */
function parseQueries(text: string, limit: number): PlannedQuery[] {
  const raw = extractJson(text) as { queries?: unknown };
  if (!Array.isArray(raw.queries)) throw new Error("В плане поиска нет списка queries");
  const out: PlannedQuery[] = [];
  for (const item of raw.queries) {
    if (typeof item !== "object" || item === null) continue;
    const { q, bucket, recency } = item as { q?: unknown; bucket?: unknown; recency?: unknown };
    if (typeof q !== "string" || !q.trim()) continue;
    const b = BUCKETS.includes(bucket as SourceBucket) ? (bucket as SourceBucket) : "world";
    const r = TIME_RANGES.includes(recency as TimeRange) ? (recency as TimeRange) : "month";
    out.push({ q: q.trim(), bucket: b, recency: r });
    if (out.length >= limit) break;
  }
  if (!out.length) throw new Error("План поиска пуст");
  return out;
}

function parseUrls(text: string, limit: number): string[] {
  const raw = extractJson(text) as { urls?: unknown };
  if (!Array.isArray(raw.urls)) return [];
  const seen = new Set<string>();
  for (const u of raw.urls) {
    if (typeof u !== "string") continue;
    try {
      const url = new URL(u);
      if (url.protocol !== "https:" && url.protocol !== "http:") continue;
      if (!seen.has(url.href)) seen.add(url.href);
    } catch {
      /* не URL — пропускаем */
    }
    if (seen.size >= limit) break;
  }
  return [...seen];
}

/** Выдача поиска в текст для модели. */
function hitsToText(hits: { bucket: SourceBucket; hit: SearchHit }[]): string {
  const labels: Record<SourceBucket, string> = {
    world: "МИР",
    kz: "КАЗАХСТАН",
    cis: "СНГ",
    science: "НАУКА",
  };
  const byBucket = new Map<SourceBucket, string[]>();
  for (const { bucket, hit } of hits) {
    const date = hit.publishedDate ? new Date(hit.publishedDate).toISOString().slice(0, 10) : "дата неизвестна";
    const line = `— ${hit.title}\n  URL: ${hit.url}\n  Дата: ${date}\n  Фрагмент: ${hit.snippet}`;
    const list = byBucket.get(bucket) ?? [];
    list.push(line);
    byBucket.set(bucket, list);
  }
  return BUCKETS.filter((b) => byBucket.has(b))
    .map((b) => `### ${labels[b]}\n\n${byBucket.get(b)!.join("\n\n")}`)
    .join("\n\n");
}

function pagesToText(pages: { url: string; text: string; via: string }[]): string {
  return pages
    .map(
      (p, i) =>
        `### Страница ${i + 1}: ${p.url}\n(открыто ${p.via === "extract" ? "через Tavily" : "напрямую"})\n\n${p.text}`,
    )
    .join("\n\n---\n\n");
}

export interface PipelineOptions {
  settings: Settings;
  date: string;
  usedTopics: string[];
  apiKey?: string;
  searchApiKey?: string;
}

/**
 * Полный конвейер: ресерч → проверка → тема и три формата → валидация → сохранение.
 * Поиск и открытие страниц выполняет наш код (search.ts), модель только думает —
 * поэтому maxSearches и maxFetches здесь настоящие пределы.
 */
export async function* runPipeline(opts: PipelineOptions): AsyncGenerator<PipelineEvent> {
  const { settings, date } = opts;
  const apiKey = opts.apiKey ?? process.env.GEMINI_API_KEY;
  const searchKey = opts.searchApiKey ?? process.env.TAVILY_API_KEY;
  if (!apiKey) {
    yield { type: "error", message: "Не задан GEMINI_API_KEY. Добавьте его в .env.local и перезапустите npm run dev." };
    return;
  }
  if (!searchKey) {
    yield { type: "error", message: "Не задан TAVILY_API_KEY. Ключ бесплатный: tavily.com → Get API key. Добавьте его в .env.local и перезапустите npm run dev." };
    return;
  }

  const client = new GoogleGenAI({ apiKey });
  /*
   * Очереди моделей. Механические шаги идут на Groq: там суточный лимит
   * на порядки больше, а работа не требует русского слога. Написание
   * остаётся на Gemini, потому что именно его голосом владелец публикует.
   */
  const mechanical = siftRotation(settings.model);
  const geminiOnly = geminiRotation(settings.model);
  const forWriting = writeRotation(settings.model, 0);
  /*
   * Подмена модели работает молча, и это правильно — прогон не должен
   * останавливаться. Но один раз сказать о ней стоит: дальше текст пишет
   * запасная модель, и слог будет другим.
   */
  const quotaNotice = createQuotaNotice(settings.model);
  const quotaLine = (failures: string[]): PipelineEvent[] => {
    const said = quotaNotice(failures);
    return said ? [{ type: "log", kind: "warn", text: said }] : [];
  };
  const startedAt = Date.now();
  const weekday = weekdayRu(date);
  const rubric = settings.brief.rubrics[rubricIndex(date)] ?? settings.brief.rubrics[0];
  const rubricTitle = rubric.split(":")[0].trim();

  let searches = 0;
  let fetches = 0;
  let credits = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  const account = (a: Answer) => {
    inputTokens += a.inputTokens;
    outputTokens += a.outputTokens;
  };

  try {
    /* ---------- 1. Ресерч ---------- */
    yield { type: "step", step: "research", status: "running" };
    yield { type: "log", kind: "info", text: `Сегодня ${weekday}, ${formatDateRu(date)}. Рубрика: ${rubricTitle}.` };

    const plan = await askFirstAvailable(client, mechanical, {
      system: buildQueriesSystem(settings),
      maxTokens: 4000,
      input: [
        `Сегодня ${weekday}, ${formatDateRu(date)} (${date}). Рубрика дня: ${rubric}.`,
        `Геофокус: ${settings.userLocation.city}, ${settings.userLocation.country}. Запросы по блокам kz и cis формулируй так, чтобы находились материалы, релевантные этому рынку.`,
        usedTopicsBlock(opts.usedTopics),
        `Составь план из ${settings.maxSearches} поисковых запросов.`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    });
    account(plan.answer);
    yield* quotaLine(plan.failures);
    const queries = parseQueries(plan.answer.text, settings.maxSearches);
    yield { type: "log", kind: "info", text: `План: ${queries.length} запросов · ${plan.via}.` };

    const hits: { bucket: SourceBucket; hit: SearchHit }[] = [];
    const seenUrls = new Set<string>();
    for (const [i, query] of queries.entries()) {
      // Прогресс в detail: шаг идёт минутами, без счётчика спиннер читается как «зависло».
      yield { type: "step", step: "research", status: "running", detail: `Поиск ${i + 1} из ${queries.length}` };
      yield { type: "log", kind: "search", text: `Ищу: ${query.q}` };
      try {
        const res = await tavilySearch(searchKey, query.q, settings.sourceDomains[query.bucket], {
          timeRange: query.recency,
          maxResults: 6,
        });
        searches++;
        credits += res.credits;
        const fresh = res.hits.filter((h) => !seenUrls.has(h.url));
        for (const hit of fresh) {
          seenUrls.add(hit.url);
          hits.push({ bucket: query.bucket, hit });
        }
        const hosts = [...new Set(fresh.map((h) => hostOf(h.url)))].slice(0, 5);
        yield {
          type: "log",
          kind: fresh.length ? "result" : "warn",
          text: fresh.length ? `${fresh.length} новых · ${hosts.join(", ")}` : "ничего нового",
        };
      } catch (e) {
        yield { type: "log", kind: "warn", text: `Поиск не удался: ${e instanceof Error ? e.message : String(e)}` };
      }
    }

    if (hits.length < 5) {
      throw new Error(
        `Поиск вернул всего ${hits.length} результатов. Проверьте списки доменов в настройках и ключ Tavily.`,
      );
    }

    const research = await askFirstAvailable(client, mechanical, {
      system: buildResearchSystem(settings),
      maxTokens: 24000,
      input: `Сегодня ${weekday}, ${formatDateRu(date)}. Рубрика дня: ${rubric}.\n\nРЕЗУЛЬТАТЫ ПОИСКА:\n\n${hitsToText(hits)}`,
    });
    account(research.answer);
    yield* quotaLine(research.failures);
    const researchNotes = research.answer.text;
    if (researchNotes.trim().length < 200) {
      throw new Error("Ресерч вернул почти пустые заметки — проверьте модель.");
    }
    yield { type: "log", kind: "result", text: `Заметки ресерча собрал ${research.via}.` };
    yield { type: "step", step: "research", status: "done", detail: `${searches} поисков, ${hits.length} источников` };

    /* ---------- 2. Проверка ---------- */
    yield { type: "step", step: "verify", status: "running" };
    let pagesBlock = "Страницы не открывались.";
    /**
     * Тексты скачанных страниц. Держим в этой области видимости, потому что
     * на шаге валидации ими проверяются цитаты и цифры: до этой правки
     * раздел «Выпуск» не проверял НИЧЕГО — цитата реального человека со
     * ссылкой уходила в файл и на экран прямо из ответа модели.
     */
    const openedTexts: string[] = [];
    const openedUrls = new Set<string>();
    let failedBlock = "";

    if (settings.maxFetches > 0) {
      const pick = await askFirstAvailable(client, mechanical, {
        system: buildPickUrlsSystem(settings),
        maxTokens: 4000,
        input: `ЗАМЕТКИ РЕСЕРЧА:\n\n${researchNotes}`,
      });
      account(pick.answer);
      yield* quotaLine(pick.failures);
      const urls = parseUrls(pick.answer.text, settings.maxFetches);

      if (urls.length) {
        // openPages отдаёт строки колбэком, поэтому пропускаем их через очередь и
        // выдаём по мере поступления: иначе шаг молчит все 40–90 секунд, а потом
        // весь лог вываливается пачкой. Заодно считаем прогресс «Открыто N из M».
        const queue: PipelineEvent[] = [];
        let wake: (() => void) | null = null;
        const emit = (event: PipelineEvent) => {
          queue.push(event);
          wake?.();
          wake = null;
        };
        let openedCount = 0;
        let pumping = true;
        const wakeUp = () => {
          pumping = false;
          wake?.();
          wake = null;
        };
        const pending = openPages(searchKey, urls, (kind, text) => {
          emit({ type: "log", kind: openLogKind(kind), text });
          // kind === "result" — это строки «Открыто: …» и «Открыто через Tavily: …».
          if (kind === "result") {
            openedCount += 1;
            emit({
              type: "step",
              step: "verify",
              status: "running",
              detail: `Открыто ${openedCount} из ${urls.length}`,
            });
          }
        }).then(
          (res) => {
            wakeUp();
            return res;
          },
          (e: unknown) => {
            wakeUp();
            throw e;
          },
        );

        while (pumping || queue.length) {
          const next = queue.shift();
          if (next) {
            yield next;
            continue;
          }
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
        }
        const opened = await pending;
        for (const pg of opened.pages) {
          openedTexts.push(pg.text);
          openedUrls.add(pg.url);
        }
        fetches = opened.pages.length;
        credits += opened.credits;
        if (opened.pages.length) pagesBlock = pagesToText(opened.pages);
        if (opened.failed.length) {
          failedBlock =
            "\n\nНЕ ОТКРЫЛИСЬ (по ним высокая уверенность недопустима):\n" +
            opened.failed.map((f) => `— ${f.url}: ${f.reason}`).join("\n");
        }
      }
    }

    const verified = await askFirstAvailable(client, geminiOnly, {
      system: buildVerifySystem(settings),
      maxTokens: 24000,
      input: `Сегодня ${weekday}, ${formatDateRu(date)}.\n\nЗАМЕТКИ РЕСЕРЧА:\n\n${researchNotes}\n\nТЕКСТЫ ОТКРЫТЫХ СТРАНИЦ:\n\n${pagesBlock}${failedBlock}`,
    });
    account(verified.answer);
    yield* quotaLine(verified.failures);
    const verifiedNotes = verified.answer.text;
    yield { type: "log", kind: "result", text: `Факты сверил ${verified.via}.` };
    yield { type: "step", step: "verify", status: "done", detail: `${fetches} страниц открыто` };

    /* ---------- 3. Тема и три формата ---------- */
    yield { type: "step", step: "write", status: "running" };
    const writeUser = [
      `Сегодня ${weekday}, ${formatDateRu(date)} (${date}). Рубрика дня: ${rubric}.`,
      usedTopicsBlock(opts.usedTopics),
      `ПРОВЕРЕННЫЕ ФАКТЫ И ЦИТАТЫ:\n\n${verifiedNotes}`,
      "Выбери тему дня, напиши три формата и верни JSON.",
    ]
      .filter(Boolean)
      .join("\n\n");

    let draftText = "";
    let attempt = 0;
    let lastError = "";
    const writeSystem = buildWriteSystem(settings);

    while (attempt < 2) {
      attempt++;
      const write = await askFirstAvailable(client, forWriting, {
        system: writeSystem,
        maxTokens: 32000,
        input:
          attempt === 1
            ? writeUser
            : [
                writeUser,
                `ТВОЙ ПРЕДЫДУЩИЙ ОТВЕТ:\n\n${draftText || "{}"}`,
                `JSON не прошёл проверку структуры: ${lastError}. Верни исправленный JSON целиком, без пояснений.`,
              ].join("\n\n"),
      });
      account(write.answer);
      yield* quotaLine(write.failures);
      draftText = write.answer.text;
      yield { type: "log", kind: "result", text: `Выпуск написал ${write.via}.` };
      yield { type: "step", step: "write", status: "done" };

      /* ---------- 4. Валидация ---------- */
      yield { type: "step", step: "validate", status: "running" };
      let draftJson: unknown;
      try {
        draftJson = extractJson(draftText);
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        yield { type: "log", kind: "warn", text: `Не удалось разобрать JSON: ${lastError}` };
        if (attempt < 2) {
          yield { type: "step", step: "write", status: "running", detail: "повторная попытка" };
          continue;
        }
        throw new Error(lastError);
      }
      const parsed = EditionDraftSchema.safeParse(draftJson);
      if (parsed.success) {
        const id = await nextEditionId(date);
        /*
         * Проверка кодом. До этого в разделе «Выпуск» её не было вообще:
         * единственной преградой была форма Zod, а цитаты, даты и цифры
         * шли из ответа модели прямо в файл. В выпуске за 22 сентября это
         * дало дословную цитату реального человека со ссылкой на страницу,
         * где такого предложения нет. Механизм лежал в соседнем модуле и
         * работал в ленте — здесь он просто не был подключён.
         */
        const checked = verifyEdition(parsed.data, openedTexts, openedUrls);
        for (const line of checked.notes) {
          yield { type: "log", kind: "warn", text: line };
        }

        const edition: Edition = {
          id,
          createdAt: new Date().toISOString(),
          ...parsed.data,
          expertLens: checked.expertLens,
          facts: checked.facts,
          unverified: [...parsed.data.unverified, ...checked.unverified],
          date,
          weekday,
          rubric: parsed.data.rubric || rubricTitle,
          meta: {
            model: settings.model,
            generatedBy: "pipeline",
            durationMs: Date.now() - startedAt,
            searches,
            fetches,
            inputTokens,
            outputTokens,
          },
        };
        yield { type: "step", step: "validate", status: "done", detail: `${edition.facts.length} фактов` };

        /* ---------- 5. Сохранение ---------- */
        yield { type: "step", step: "save", status: "running" };
        await saveEdition(edition);
        yield { type: "step", step: "save", status: "done", detail: `${id}.json` };
        // Кошелёк Tavily общий с лентой и исследованием: считаем вместе.
        const monthly = await addUsage({ tavilyCredits: credits });
        yield {
          type: "log",
          kind: "info",
          text: `Потрачено кредитов Tavily: ${credits}. За месяц: ${monthly.tavilyCredits}, прогонов ${monthly.runs}.`,
        };
        yield { type: "done", edition };
        return;
      }
      lastError = parsed.error.issues
        .slice(0, 6)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      yield { type: "log", kind: "warn", text: `Структура не сошлась: ${lastError}` };
      if (attempt < 2) {
        yield { type: "step", step: "write", status: "running", detail: "повторная попытка" };
      }
    }
    throw new Error(`Выпуск не прошёл проверку структуры: ${lastError}`);
  } catch (e) {
    yield { type: "error", message: describeModelError(e) };
  }
}
