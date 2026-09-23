import { NextResponse } from "next/server";
import { listEditions } from "@/lib/store";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await listEditions());
}
