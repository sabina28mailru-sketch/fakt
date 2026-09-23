import { NextResponse } from "next/server";
import { readResearch, writeResearchTags } from "@/lib/store";

export const runtime = "nodejs";

export async function GET() {
  const store = await readResearch();
  return NextResponse.json({ tags: store.tags });
}

export async function PUT(req: Request) {
  const body = (await req.json().catch(() => null)) as { tags?: unknown } | null;
  if (!body || !Array.isArray(body.tags)) {
    return NextResponse.json({ error: "Ожидался список тем в поле tags" }, { status: 400 });
  }
  const tags = body.tags.filter((t): t is string => typeof t === "string");
  const store = await writeResearchTags(tags);
  return NextResponse.json({ tags: store.tags });
}
