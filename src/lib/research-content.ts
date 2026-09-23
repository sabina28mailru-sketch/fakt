import { GoogleGenAI } from "@google/genai";
import { EditionDraftSchema, type Edition, type PipelineEvent, type ResearchResult, type Settings } from "./schema";
import { JSON_SHAPE, buildWriteSystem } from "./brief";
import { askFirstAvailable, describeModelError, writeRotation } from "./model";
import { nextEditionId, saveEdition } from "./store";
import { formatDateRu, weekdayRu } from "./utils";

/**
 * Контент по исследованной теме.
 *
 * Отличие от ежедневного выпуска: тему и факты не выбирает система — они
 * уже отобраны и проверены в разделе «Темы». Здесь остаётся один шаг:
 * написать три формата строго из этих материалов. Ресерч и проверку
 * заново не гоняем, поэтому прогон стоит один вызов модели вместо пяти.
 */

function contentSystem(settings: Settings, topic: string): string {
  return [
    buildWriteSystem(settings),
    `ТЕМА ЗАДАНА ПОЛЬЗОВАТЕЛЕМ: ${topic}. Не подменяй её и не расширяй: все три формата — именно про неё.`,
    "Материалы ниже уже проверены: страницы открыты, источники и даты подтверждены. Бери факты и ссылки только оттуда. Ничего не добавляй из общих знаний.",
    "Поле rubric заполни коротким названием темы, weekday и date подставит система.",
  ].join("\n\n");
}

/** Проверенные материалы в текст для модели: факты идут вместе со ссылкой и датой. */
function materialsToText(result: ResearchResult): string {
  const core = result.materials.filter((m) => m.relation === "core");
  const pool = core.length > 0 ? core : result.materials;
  return pool
    .slice(0, 10)
    .map((m) => {
      const lines = [
        `### ${m.title}`,
        `Источник: ${m.outlet} — ${m.url}`,
        m.date ? `Дата публикации: ${m.date}` : "Дата публикации: не установлена",
        `Надёжность: ${m.credibility.score}/100 (${m.credibility.label})`,
        `О чём: ${m.summary}`,
        m.facts.length ? `Факты:\n${m.facts.map((f) => `— ${f}`).join("\n")}` : "Конкретных чисел на странице нет.",
        m.sources.length
          ? `Первоисточники: ${m.sources.map((s) => `${s.outlet} — ${s.url}`).join("; ")}`
          : "",
      ];
      return lines.filter(Boolean).join("\n");
    })
    .join("\n\n---\n\n");
}

export interface ContentOptions {
  result: ResearchResult;
  settings: Settings;
  date: string;
  apiKey?: string;
}

export async function* runResearchContent(opts: ContentOptions): AsyncGenerator<PipelineEvent> {
  const { result, settings, date } = opts;
  const apiKey = opts.apiKey ?? process.env.GEMINI_API_KEY;
  if (!apiKey) {
    yield { type: "error", message: "Не задан GEMINI_API_KEY. Добавьте его в .env.local и перезапустите npm run dev." };
    return;
  }

  const usable = result.materials.filter((m) => m.relation === "core");
  if (usable.length === 0 && result.materials.length === 0) {
    yield {
      type: "error",
      message: `По теме «${result.topic}» нет ни одного проверенного материала. Сначала проведите исследование заново — писать контент не из чего.`,
    };
    return;
  }

  const client = new GoogleGenAI({ apiKey });
  const startedAt = Date.now();
  const weekday = weekdayRu(date);

  try {
    yield { type: "step", step: "research", status: "done", detail: `${result.materials.length} материалов из исследования` };
    yield { type: "step", step: "verify", status: "done", detail: `${usable.length} по теме` };
    yield { type: "log", kind: "info", text: `Тема: ${result.topic}. Пишу три формата по проверенным материалам.` };

    yield { type: "step", step: "write", status: "running" };
    const userBlock = [
      `Сегодня ${weekday}, ${formatDateRu(date)} (${date}).`,
      `ТЕМА: ${result.topic}`,
      result.answer.summary ? `КРАТКО ПО ТЕМЕ:\n${result.answer.summary}` : "",
      `ПРОВЕРЕННЫЕ МАТЕРИАЛЫ:\n\n${materialsToText(result)}`,
      "Напиши три формата и верни JSON строго такой формы:\n" + JSON_SHAPE,
    ]
      .filter(Boolean)
      .join("\n\n");

    let draftText = "";
    let lastError = "";
    let attempt = 0;
    let inputTokens = 0;
    let outputTokens = 0;

    while (attempt < 2) {
      attempt++;
      // Ротация вместо одной модели: раньше кончившаяся суточная квота
      // роняла превращение темы в выпуск целиком. Русский текст — Gemini
      // первым, Groq запасным.
      const write = await askFirstAvailable(client, writeRotation(settings.model, 0), {
        system: contentSystem(settings, result.topic),
        maxTokens: 32000,
        input:
          attempt === 1
            ? userBlock
            : [
                userBlock,
                `ТВОЙ ПРЕДЫДУЩИЙ ОТВЕТ:\n\n${draftText || "{}"}`,
                `JSON не прошёл проверку структуры: ${lastError}. Верни исправленный JSON целиком, без пояснений.`,
              ].join("\n\n"),
      });
      inputTokens += write.answer.inputTokens;
      outputTokens += write.answer.outputTokens;
      draftText = write.answer.text;
      yield { type: "step", step: "write", status: "done" };

      yield { type: "step", step: "validate", status: "running" };
      let draftJson: unknown;
      try {
        const fenced = draftText.match(/```(?:json)?\s*([\s\S]*?)```/);
        const candidate = fenced ? fenced[1] : draftText;
        const start = candidate.indexOf("{");
        const end = candidate.lastIndexOf("}");
        if (start === -1 || end === -1) throw new Error("В ответе модели нет JSON-объекта");
        draftJson = JSON.parse(candidate.slice(start, end + 1));
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
        const edition: Edition = {
          id,
          createdAt: new Date().toISOString(),
          ...parsed.data,
          date,
          weekday,
          rubric: parsed.data.rubric || result.topic,
          meta: {
            model: settings.model,
            generatedBy: "pipeline",
            durationMs: Date.now() - startedAt,
            searches: result.queries.length,
            fetches: result.materials.length,
            inputTokens,
            outputTokens,
          },
        };
        yield { type: "step", step: "validate", status: "done", detail: `${edition.facts.length} фактов` };
        yield { type: "step", step: "save", status: "running" };
        await saveEdition(edition);
        yield { type: "step", step: "save", status: "done", detail: `${id}.json` };
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
    throw new Error(`Контент не прошёл проверку структуры: ${lastError}`);
  } catch (e) {
    yield { type: "error", message: describeModelError(e) };
  }
}
