import { ApiError, GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";
import { askFirstAvailable, writeRotation } from "@/lib/model";
import { listEditions, listFeeds, readSettings, readUsage, usesDatabase } from "@/lib/store";

export const runtime = "nodejs";

/**
 * GET /api/health — «всё ли на месте».
 *
 * Три проверки, и каждая идёт до конца независимо от остальных. Раньше
 * ответ обрывался на первой же неудаче, и человек, у которого кончилась
 * суточная квота модели, так и не узнавал, приняты ли остальные ключи.
 *
 * Модель проверяется ТОЙ ЖЕ очередью, которой пользуются конвейеры.
 * Спрашивать одну выбранную модель было прямым враньём: её двадцать
 * суточных запросов кончаются к середине дня, и кнопка загоралась
 * красным, пока приложение прекрасно работало на следующей в очереди.
 *
 * Хранилище проверяется первым и названо вслух. На бессерверном хостинге
 * забытая переменная DATABASE_URL не ломает сайт заметно — он молча
 * читает файлы из репозитория и выглядит живым, пока первая же запись
 * не пропадёт. Пусть об этом говорят до того, как пропадёт.
 */

interface Check {
  label: string;
  ok: boolean;
  detail: string;
}

export async function GET() {
  const settings = await readSettings();

  const checks: Check[] = [
    await storageCheck(),
    await modelCheck(settings.model),
    await searchCheck(settings.sourceDomains.kz),
  ];

  const usage = await readUsage();
  // Числа после тире, а не перед существительным: иначе «3 прогонов».
  const spend =
    `За ${usage.month} потрачено: кредитов поиска — ${usage.tavilyCredits}, ` +
    `вызовов моделей — ${usage.modelCalls}, прогонов — ${usage.runs}.`;

  const bad = checks.filter((c) => !c.ok);
  return NextResponse.json({
    ok: bad.length === 0,
    checks,
    message:
      bad.length === 0
        ? `Всё на месте. ${spend}`
        : `Не в порядке: ${bad.map((c) => c.label.toLowerCase()).join(", ")}. ${spend}`,
  });
}

/** Где лежат данные и читаются ли они. */
async function storageCheck(): Promise<Check> {
  const where = usesDatabase() ? "база Postgres" : "файлы в data/";
  try {
    const [editions, feeds] = await Promise.all([listEditions(), listFeeds(3)]);
    return {
      label: "Хранилище",
      ok: true,
      detail: `${where} — выпусков ${editions.length}, лент за последние дни ${feeds.length}.`,
    };
  } catch (e) {
    return { label: "Хранилище", ok: false, detail: `${where} не отвечает: ${describe(e)}` };
  }
}

/** Отвечает ли хоть кто-то из очереди — и кто именно. */
async function modelCheck(primary: string): Promise<Check> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { label: "Модель", ok: false, detail: "GEMINI_API_KEY не задан." };
  }
  const noGroq = process.env.GROQ_API_KEY ? "" : " Ключа Groq нет — запасных моделей меньше.";
  try {
    const client = new GoogleGenAI({ apiKey });
    const { via, failures } = await askFirstAvailable(
      client,
      writeRotation(primary),
      { system: "Отвечай одним словом, без пояснений.", input: "Скажи: ок", maxTokens: 256 },
      6,
    );
    if (via === primary) {
      return { label: "Модель", ok: true, detail: `Отвечает ${via}.${noGroq}` };
    }
    // Не беда, а норма работы: очередь для того и нужна. Но причину показываем,
    // иначе смена модели выглядит необъяснимой сменой слога в текстах.
    return {
      label: "Модель",
      ok: true,
      detail:
        `Отвечает ${via}, основная ${primary} сейчас занята: ${shortReason(failures[0])} ` +
        `Конвейеры идут по той же очереди.${noGroq}`,
    };
  } catch (e) {
    return { label: "Модель", ok: false, detail: `${describe(e)}${noGroq}` };
  }
}

/**
 * Ищет ли поиск. Запрос самый дешёвый (basic — 1 кредит), но по реальному
 * списку доменов: важно убедиться не только в том, что ключ принят, а что
 * выдача по этим источникам вообще есть.
 */
async function searchCheck(domains: string[]): Promise<Check> {
  const searchKey = process.env.TAVILY_API_KEY;
  if (!searchKey) {
    return {
      label: "Поиск",
      ok: false,
      detail: "TAVILY_API_KEY не задан. Ключ бесплатный: tavily.com → Get API key.",
    };
  }
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${searchKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        query: "личный бренд",
        search_depth: "basic",
        max_results: 3,
        include_domains: domains,
        include_domains_mode: "restrict",
        include_usage: true,
      }),
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 200);
      return { label: "Поиск", ok: false, detail: `Tavily ответил ${res.status}. ${body}` };
    }
    const data = (await res.json()) as { results?: unknown[]; usage?: { credits?: number } };
    const found = data.results?.length ?? 0;
    return {
      label: "Поиск",
      ok: true,
      detail: `По казахстанским источникам найдено: ${found}. Потрачено кредитов: ${data.usage?.credits ?? 0}.`,
    };
  } catch (e) {
    return { label: "Поиск", ok: false, detail: describe(e) };
  }
}

/**
 * Причина отказа коротко. В строке из очереди сначала идёт имя модели, а
 * его мы уже назвали рядом; дальше — объяснение, за которым часто следует
 * совет сменить модель вручную. Совет здесь лишний: очередь уже сменила её
 * сама, и повторять его значило бы звать человека чинить то, что работает.
 */
function shortReason(line?: string): string {
  if (!line) return "причина не сообщена.";
  const dash = line.indexOf(" — ");
  const after = dash > 0 ? line.slice(dash + 3) : line;
  const stop = after.indexOf(". ");
  return stop > 0 ? after.slice(0, stop + 1) : after;
}

function describe(e: unknown): string {
  if (e instanceof ApiError) return `API ответил ${e.status ?? "?"}: ${e.message}`;
  if (e instanceof Error) {
    const cause = (e as { cause?: { message?: string } }).cause;
    return cause?.message ?? e.message;
  }
  return String(e);
}
