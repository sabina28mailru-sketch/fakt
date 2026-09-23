import { runPipeline } from "@/lib/pipeline";
import { listEditions, readSettings } from "@/lib/store";
import { todayIso } from "@/lib/utils";

export const runtime = "nodejs";
export const maxDuration = 600;

/**
 * POST /api/generate — запускает конвейер и стримит события как SSE:
 * data: {"type":"step",...}\n\n
 */
export async function POST(req: Request) {
  const settings = await readSettings();
  const body = (await req.json().catch(() => ({}))) as { date?: string };
  const date = body.date ?? todayIso(settings.userLocation.timezone);
  const previous = await listEditions();
  const usedTopics = previous.slice(0, 14).map((e) => e.topic.title);

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
        for await (const event of runPipeline({ settings, date, usedTopics })) {
          // Клиент нажал «Остановить» — прекращаем прогон, не дожидаясь следующего шага.
          if (req.signal.aborted) break;
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
