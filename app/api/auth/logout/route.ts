import { NextResponse } from "next/server";
import { clearCurrentSession, clearSessionCookie } from "@/lib/auth";

export async function POST() {
  await clearCurrentSession();
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}
