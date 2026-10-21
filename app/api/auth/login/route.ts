import { NextResponse } from "next/server";
import { z } from "zod";
import { createLoginSession, getClientIp, setSessionCookie, verifyUser } from "@/lib/auth";

const authSchema = z.object({
  username: z.string().min(3).max(24),
  password: z.string().min(6).max(64)
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = authSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const user = await verifyUser(parsed.data, getClientIp(request));
    const token = await createLoginSession(user.user_id);
    await setSessionCookie(token);

    return NextResponse.json({ user });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "登录失败。" }, { status: 401 });
  }
}
