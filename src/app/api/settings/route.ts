import { NextResponse } from "next/server";
import { SettingsSchema } from "@/lib/schema";
import { readSettings, writeSettings } from "@/lib/store";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await readSettings());
}

export async function PUT(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = SettingsSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Настройки не прошли проверку", issues: parsed.error.issues.slice(0, 5) },
      { status: 400 },
    );
  }
  await writeSettings(parsed.data);
  return NextResponse.json(parsed.data);
}
