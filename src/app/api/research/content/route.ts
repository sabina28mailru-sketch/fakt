import { runResearchContent } from "@/lib/research-content";
import { readResearch, readSettings } from "@/lib/store";
import { todayIso } from "@/lib/utils";

export const runtime = "nodejs";
/*
 * Потолок длительности запроса. Локально ограничения нет, но бессерверный
 * хостинг обрывает функцию по своему пределу, и 600 секунд он не даст.
 * 300 — столько, сколько там вообще бывает доступно; прогон ленты
 * укладывается в 130 секунд, выпуска — в 260.
 */
export const maxDuration = 300;

/**
 * POST /api/research/content — три формата по теме, уже исследованной в разделе «Темы».
 * Берёт сохранённый результат исследования, чтобы не гонять поиск заново.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { topic?: string; date?: string };
  const topic = typeof body.topic === "string" ? body.topic.trim() : "";
  const [settings, store] = await Promise.all([readSettings(), readResearch()]);
  const result = store.results.find((r) => r.topic === topic) ?? store.results[0];
  const date = body.date ?? todayIso(settings.userLocation.timezone);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (obj: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };
      const heartbeat = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(": ping\n\n"));
      }, 15000);
      try {
        if (!result) {
          send({ type: "error", message: "Исследование по этой теме не найдено. Сначала нажмите «Исследовать»." });
        } else {
          for await (const event of runResearchContent({ result, settings, date })) {
            if (req.signal.aborted) break;
            send(event);
          }
        }
      } catch (e) {
        if (!req.signal.aborted) send({ type: "error", message: e instanceof Error ? e.message : String(e) });
      } finally {
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
