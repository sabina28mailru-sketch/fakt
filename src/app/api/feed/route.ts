import { runFeed } from "@/lib/feed";
import { readFeed, readSettings } from "@/lib/store";
import { todayIso } from "@/lib/utils";

export const runtime = "nodejs";
export const maxDuration = 600;

/**
 * Даты, по которым прогон уже идёт. Замок нужен буквально: две вкладки,
 * открытые утром, запускали бы два прогона и тратили двойную квоту моделей
 * и двойные кредиты Tavily ради одной и той же ленты. Файл на диске
 * предохранителем быть не может — он появляется только в конце прогона.
 */
const inFlight = new Set<string>();

/** GET /api/feed?date=ГГГГ-ММ-ДД — лента за день, если она уже собрана. */
export async function GET(req: Request) {
  const settings = await readSettings();
  const url = new URL(req.url);
  const asked = url.searchParams.get("date") ?? "";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : todayIso(settings.userLocation.timezone);
  const feed = await readFeed(date);
  return Response.json({ date, feed });
}

/**
 * POST /api/feed — собрать ленту дня. Стримит события как SSE.
 * Лента сохраняется внутри runFeed: её файл — одна штука на дату,
 * поэтому повторный запуск в тот же день перезаписывает сегодняшнюю.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { date?: string };
  const settings = await readSettings();
  const date =
    typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
      ? body.date
      : todayIso(settings.userLocation.timezone);

  if (inFlight.has(date)) {
    return Response.json(
      { error: "Лента на эту дату уже собирается. Откройте вкладку, где идёт прогон, или дождитесь его конца." },
      { status: 409 },
    );
  }
  inFlight.add(date);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (obj: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };
      // Шаги идут минутами; без пинга посредники рвут простаивающее соединение.
      const heartbeat = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(": ping\n\n"));
      }, 15000);
      try {
        for await (const event of runFeed({ settings, date })) {
          if (req.signal.aborted) break;
          send(event);
        }
      } catch (e) {
        if (!req.signal.aborted) {
          send({ type: "error", message: e instanceof Error ? e.message : String(e) });
        }
      } finally {
        inFlight.delete(date);
        clearInterval(heartbeat);
        closed = true;
        try {
          controller.close();
        } catch {
          /* поток уже закрыт разрывом соединения */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
