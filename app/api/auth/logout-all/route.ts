import { NextResponse } from "next/server";
import { clearAllUserSessions, clearSessionCookie, getCurrentUser } from "@/lib/auth";

export async function POST() {
  const user = await getCurrentUser();
  if (user) {
    await clearAllUserSessions(user.user_id);
  }
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}
