import { ApiError, GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";
import { readSettings, readUsage } from "@/lib/store";

export const runtime = "nodejs";

/** GET /api/health — проверяет оба ключа: модель отвечает и поиск ищет. */
export async function GET() {
  const apiKey = process.env.GEMINI_API_KEY;
  const searchKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ ok: false, message: "GEMINI_API_KEY не задан в .env.local" });
  }
  if (!searchKey) {
    return NextResponse.json({
      ok: false,
      message: "TAVILY_API_KEY не задан в .env.local. Ключ бесплатный: tavily.com → Get API key.",
    });
  }

  const settings = await readSettings();
  let model: string;
  try {
    const client = new GoogleGenAI({ apiKey });
    const res = await client.interactions.create({
      model: settings.model,
      input: "Ответь одним словом: ок",
      // thinking_level low — иначе короткий бюджет уйдёт в рассуждения и ответ придёт пустым.
      generation_config: { max_output_tokens: 256, thinking_level: "low" },
      store: false,
    });
    model = res.model ?? settings.model;
  } catch (e) {
    return NextResponse.json({ ok: false, message: `Модель: ${describe(e)}` });
  }

  // Поиск проверяем самым дешёвым запросом (basic — 1 кредит), но по реальному списку доменов:
  // важно убедиться не только в том, что ключ принят, а что выдача по этим источникам вообще есть.
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${searchKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        query: "личный бренд",
        search_depth: "basic",
        max_results: 3,
        include_domains: settings.sourceDomains.kz,
        include_domains_mode: "restrict",
        include_usage: true,
      }),
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 200);
      return NextResponse.json({ ok: false, message: `Поиск: Tavily ответил ${res.status}. ${body}` });
    }
    const data = (await res.json()) as { results?: unknown[]; usage?: { credits?: number } };
    const found = data.results?.length ?? 0;
    // Расход за месяц общий на три конвейера. Показываем здесь, потому что
    // «проверить подключение» — единственное место, куда человек заходит
    // именно чтобы убедиться, что всё в порядке.
    const usage = await readUsage();
    return NextResponse.json({
      ok: true,
      model,
      usage,
      message:
        `Ключи приняты. Модель ${model} отвечает, поиск по казахстанским источникам вернул ${found} результатов ` +
        `(${data.usage?.credits ?? 0} кредит). За ${usage.month} потрачено кредитов Tavily: ${usage.tavilyCredits}, ` +
        `прогонов: ${usage.runs}, вызовов моделей: ${usage.modelCalls}.`,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, message: `Поиск: ${describe(e)}` });
  }
}

function describe(e: unknown): string {
  if (e instanceof ApiError) return `API ответил ${e.status ?? "?"}: ${e.message}`;
  if (e instanceof Error) {
    const cause = (e as { cause?: { message?: string } }).cause;
    return cause?.message ?? e.message;
  }
  return String(e);
}
