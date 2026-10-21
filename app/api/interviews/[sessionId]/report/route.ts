import { NextResponse } from "next/server";
import { getCurrentUser, unauthorizedResponse } from "@/lib/auth";
import { getUserSession } from "@/lib/db";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) return unauthorizedResponse();

  const { sessionId } = await context.params;
  const session = await getUserSession(sessionId, user.user_id);

  if (!session) {
    return NextResponse.json({ error: "Interview session not found." }, { status: 404 });
  }

  if (!session.report) {
    return NextResponse.json({ error: "Report is not ready." }, { status: 404 });
  }

  return NextResponse.json(session.report);
}
