import { NextResponse } from "next/server";
import { getCurrentUser, unauthorizedResponse } from "@/lib/auth";
import { deleteSession, getUserSession } from "@/lib/db";

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

  const currentQuestion =
    session.question_plan.find((question) => question.question_id === session.current_question_id) ?? null;

  return NextResponse.json({
    session,
    current_question: currentQuestion
  });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) return unauthorizedResponse();

  const { sessionId } = await context.params;
  const deleted = await deleteSession(sessionId, user.user_id);

  if (!deleted) {
    return NextResponse.json({ error: "Interview session not found." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
