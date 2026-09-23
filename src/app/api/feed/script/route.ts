import { runFeedScript } from "@/lib/feed";
import { describeModelError } from "@/lib/model";
import { FEED_KINDS, type FeedKind } from "@/lib/schema";
import { readSettings } from "@/lib/store";
import { todayIso } from "@/lib/utils";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Сценарии, которые пишутся прямо сейчас. Ключ — дата и тип темы.
 * Двойное нажатие кнопки не должно платить дважды: сценарий пишется
 * одним вызовом модели, и он не бесплатный.
 */
const inFlight = new Set<string>();

/**
 * POST /api/feed/script — написать три формата для одной темы дня.
 *
 * Отдельно от сборки ленты намеренно: раздел «Сегодня» приносит разбор
 * новости, а сценарий заказывают для той темы, которую выбрали. Писать
 * их сразу для всех трёх значило тратить две трети квоты впустую.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { date?: string; kind?: unknown };
  const settings = await readSettings();
  const date =
    typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
      ? body.date
      : todayIso(settings.userLocation.timezone);

  const kind = FEED_KINDS.find((k) => k === body.kind) as FeedKind | undefined;
  if (!kind) {
    return Response.json({ error: "Не указан тип темы." }, { status: 400 });
  }

  const key = `${date}:${kind}`;
  if (inFlight.has(key)) {
    return Response.json({ error: "Сценарий для этой темы уже пишется." }, { status: 409 });
  }
  inFlight.add(key);

  try {
    const { script, via, calls } = await runFeedScript({ settings, date, kind });
    return Response.json({ script, via, calls });
  } catch (e) {
    return Response.json({ error: describeModelError(e) }, { status: 502 });
  } finally {
    inFlight.delete(key);
  }
}
