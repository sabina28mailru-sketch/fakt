import { runResearch } from "@/lib/research";
import { readSettings, saveResearchResult } from "@/lib/store";

export const runtime = "nodejs";
/*
 * Потолок длительности запроса. Локально ограничения нет, но бессерверный
 * хостинг обрывает функцию по своему пределу, и 600 секунд он не даст.
 * 300 — столько, сколько там вообще бывает доступно; прогон ленты
 * укладывается в 130 секунд, выпуска — в 260.
 */
export const maxDuration = 300;

/**
 * POST /api/research — исследование произвольной темы.
 * Стримит события конвейера как SSE, в конце отдаёт результат и сохраняет его.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { topic?: string };
  const topic = typeof body.topic === "string" ? body.topic.trim().slice(0, 200) : "";
  const settings = await readSettings();

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
        for await (const event of runResearch({ topic, settings })) {
          if (req.signal.aborted) break;
          if (event.type === "done") await saveResearchResult(event.result);
          send(event);
        }
      } catch (e) {
        if (!req.signal.aborted) {
          send({ type: "error", message: e instanceof Error ? e.message : String(e) });
        }
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
