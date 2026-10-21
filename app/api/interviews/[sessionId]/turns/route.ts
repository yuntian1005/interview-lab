import { NextResponse } from "next/server";
import { z } from "zod";
import { evaluateTurn, generateReport } from "@/lib/coze";
import { extractScore, looksLikeFinalReport, sendDifyChatMessage } from "@/lib/dify";
import { getCurrentUser, unauthorizedResponse } from "@/lib/auth";
import { getUserSession, makeId, saveSession } from "@/lib/db";
import { Report, Turn } from "@/lib/types";
import {
  buildPromptSecurityInstruction,
  detectPromptInjection,
  mergeSecurityFindings,
  wrapUntrustedContent
} from "@/lib/promptSecurity";

const submitTurnSchema = z.object({
  question_id: z.string().min(1),
  answer_text: z.string().min(1, "回答不能为空"),
  turn_type: z.enum(["main_answer", "followup_answer"]).default("main_answer"),
  audio_metrics: z.record(z.unknown()).optional(),
  video_metrics: z.record(z.unknown()).optional()
});

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) return unauthorizedResponse();

  const { sessionId } = await context.params;
  const body = await request.json();
  const parsed = submitTurnSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const session = await getUserSession(sessionId, user.user_id);

  if (!session) {
    return NextResponse.json({ error: "Interview session not found." }, { status: 404 });
  }

  if (session.status === "completed") {
    return NextResponse.json({ error: "Interview already completed." }, { status: 409 });
  }

  if (session.provider === "dify") {
    return handleDifyTurn(session, parsed.data);
  }

  return handleLocalTurn(session, parsed.data);
}

async function handleDifyTurn(
  session: NonNullable<Awaited<ReturnType<typeof getUserSession>>>,
  data: z.infer<typeof submitTurnSchema>
) {
  const now = new Date().toISOString();
  const securityFindings = mergeSecurityFindings(detectPromptInjection(data.answer_text, "answer"));
  const askedQuestions = session.turns
    .map((turn) => turn.followup_question)
    .filter(Boolean)
    .slice(-8);

  const query = [
    buildPromptSecurityInstruction(securityFindings),
    "",
    "请继续推进模拟面试。",
    "",
    "面试配置：",
    `- 目标岗位：${session.job_role ?? "自定义岗位"}`,
    `- 岗位级别：${session.job_level}`,
    `- 面试时长：${session.interview_duration ?? "10 分钟"}`,
    `- 问题难度：${session.difficulty ?? "中等"}`,
    `- 题目数量：${session.question_count ?? 5}`,
    `- 面试模式：${session.mode}`,
    "",
    "硬性规则：",
    "1. 每轮只能输出一个问题，或在需要结束时输出最终 Markdown 报告。",
    "2. 严禁重复已经问过的问题，也不要换一种说法问同一个问题。",
    "3. 如果候选人已经回答了某个追问点，应切换到新的能力维度或进入下一题。",
    "4. 追问必须基于候选人上一轮回答中的缺口，不能机械照搬题库。",
    "5. 如果候选人要求结束或生成阶段性报告，请立即输出 Markdown 报告。",
    "",
    "已经问过的问题，不可重复：",
    askedQuestions.length ? askedQuestions.join("\n") : "暂无",
    "",
    wrapUntrustedContent("候选人本轮回答", data.answer_text)
  ].join("\n");

  const dify = await sendDifyChatMessage({
    user: session.session_id,
    conversation_id: session.dify_conversation_id,
    query,
    inputs: {
      resume_text: wrapUntrustedContent("简历", session.resume_text),
      jd_text: wrapUntrustedContent("岗位JD", session.jd_text),
      job_level: session.job_level,
      job_role: session.job_role ?? "自定义岗位",
      interview_duration: session.interview_duration ?? "10 分钟",
      difficulty: session.difficulty ?? "中等",
      question_count: String(session.question_count ?? 5),
      security_instruction: buildPromptSecurityInstruction(securityFindings)
    }
  });

  const isReport = looksLikeFinalReport(dify.answer);
  const duplicate = isDuplicateQuestion(dify.answer, askedQuestions);
  const assistantMessage = duplicate && !isReport
    ? buildNonRepeatedFallbackQuestion(session.turns.length)
    : dify.answer;

  const turn: Turn = {
    turn_id: makeId("t"),
    session_id: session.session_id,
    question_id: "DIFY",
    turn_type: data.turn_type,
    answer_text: data.answer_text,
    content_score: 0,
    logic_score: 0,
    evidence: [],
    covered_anchors: [],
    missing_anchors: [],
    risks: duplicate && !isReport ? ["Dify 返回了重复问题，系统已自动切换追问角度。"] : [],
    followup_needed: !isReport,
    followup_question: isReport ? "" : assistantMessage,
    audio_metrics: data.audio_metrics ?? {},
    video_metrics: data.video_metrics ?? {},
    created_at: now
  };

  session.turns.push(turn);
  session.dify_conversation_id = dify.conversation_id || session.dify_conversation_id;
  session.updated_at = now;

  if (isReport) {
    const report: Report = {
      report_id: makeId("r"),
      session_id: session.session_id,
      total_score: extractScore(dify.answer),
      competency_scores: {},
      strengths: [],
      risks: [],
      improvements: [],
      report_markdown: dify.answer,
      created_at: now
    };

    session.status = "completed";
    session.report = report;
    session.current_question_id = "";
    await saveSession(session);

    return NextResponse.json({
      next_action: "finish_interview",
      message: "本次模拟面试已完成，报告已生成。",
      report,
      turn
    });
  }

  await saveSession(session);

  return NextResponse.json({
    next_action: "ask_next_question",
    message: assistantMessage,
    current_question: {
      question_id: "DIFY",
      question_type: "dify_chat",
      question: assistantMessage,
      competency: "综合面试"
    },
    turn
  });
}

async function handleLocalTurn(
  session: NonNullable<Awaited<ReturnType<typeof getUserSession>>>,
  data: z.infer<typeof submitTurnSchema>
) {
  const question = session.question_plan.find((item) => item.question_id === data.question_id);

  if (!question) {
    return NextResponse.json({ error: "Question not found." }, { status: 404 });
  }

  const history = session.turns.filter((turn) => turn.question_id === question.question_id);
  const followupCount = history.length;

  const evaluated = await evaluateTurn({
    session_id: session.session_id,
    question_id: question.question_id,
    question_text: question.question,
    competency: question.competency,
    expected_anchors: question.expected_anchors,
    followup_targets: question.followup_targets,
    answer_text: data.answer_text,
    followup_count: followupCount,
    max_followups: question.max_followups,
    history,
    audio_metrics: data.audio_metrics ?? {},
    video_metrics: data.video_metrics ?? {}
  });

  const now = new Date().toISOString();
  const duplicateFollowup = isDuplicateQuestion(
    evaluated.followup_question,
    history.map((turn) => turn.followup_question)
  );

  const turn: Turn = {
    turn_id: makeId("t"),
    session_id: session.session_id,
    question_id: question.question_id,
    turn_type: data.turn_type,
    answer_text: data.answer_text,
    content_score: evaluated.content_score,
    logic_score: evaluated.logic_score,
    evidence: evaluated.evidence,
    covered_anchors: evaluated.covered_anchors,
    missing_anchors: evaluated.missing_anchors,
    risks: duplicateFollowup
      ? [...evaluated.risks, "检测到重复追问，系统已自动进入下一题。"]
      : evaluated.risks,
    followup_needed: evaluated.need_followup && !duplicateFollowup,
    followup_question: duplicateFollowup ? "" : evaluated.followup_question,
    audio_metrics: data.audio_metrics ?? {},
    video_metrics: data.video_metrics ?? {},
    created_at: now
  };

  session.turns.push(turn);
  session.updated_at = now;

  if (turn.followup_needed && followupCount < question.max_followups) {
    await saveSession(session);

    return NextResponse.json({
      next_action: "ask_followup",
      message: turn.followup_question,
      turn_score_preview: {
        content_score: evaluated.content_score,
        logic_score: evaluated.logic_score
      },
      current_question: question,
      turn
    });
  }

  if (!session.completed_question_ids.includes(question.question_id)) {
    session.completed_question_ids.push(question.question_id);
  }

  const nextQuestion = session.question_plan.find(
    (item) => !session.completed_question_ids.includes(item.question_id)
  );

  if (nextQuestion) {
    session.current_question_id = nextQuestion.question_id;
    await saveSession(session);

    return NextResponse.json({
      next_action: "ask_next_question",
      message: nextQuestion.question,
      current_question: nextQuestion,
      turn
    });
  }

  const reportResult = await generateReport({
    candidate_profile: session.candidate_profile,
    jd_profile: session.jd_profile,
    match_matrix: session.match_matrix,
    question_plan: session.question_plan,
    turns: session.turns,
    audio_metrics_summary: {},
    video_metrics_summary: {}
  });

  const report: Report = {
    report_id: makeId("r"),
    session_id: session.session_id,
    created_at: new Date().toISOString(),
    ...reportResult
  };

  session.status = "completed";
  session.current_question_id = "";
  session.report = report;
  session.updated_at = report.created_at;
  await saveSession(session);

  return NextResponse.json({
    next_action: "finish_interview",
    message: "本次模拟面试已完成，报告已生成。",
    report,
    turn
  });
}

function normalizeQuestion(text: string): string {
  return text
    .replace(/\s+/g, "")
    .replace(/[，。！？、,.!?;；:："'“”‘’（）()【】\[\]#*_`-]/g, "")
    .toLowerCase()
    .slice(0, 120);
}

function isDuplicateQuestion(nextQuestion: string, previousQuestions: Array<string | undefined>): boolean {
  const normalizedNext = normalizeQuestion(nextQuestion);
  if (!normalizedNext || normalizedNext.length < 12) return false;

  return previousQuestions.some((question) => {
    if (!question) return false;
    const normalizedPrevious = normalizeQuestion(question);
    if (!normalizedPrevious) return false;
    return (
      normalizedNext === normalizedPrevious ||
      normalizedNext.includes(normalizedPrevious) ||
      normalizedPrevious.includes(normalizedNext)
    );
  });
}

function buildNonRepeatedFallbackQuestion(turnCount: number): string {
  const questions = [
    "我们换一个角度。请你讲一次遇到需求不清晰时，你如何澄清目标、拆解任务并推动落地？",
    "接下来考察复盘能力。请说一个你做得不够好的项目环节，以及后来如何改进。",
    "我们看协作能力。请讲一次你和他人协作解决问题的经历，你具体承担了什么责任？",
    "请结合目标岗位，说说你目前最需要补强的一项能力，以及你准备如何提升。"
  ];

  return questions[turnCount % questions.length];
}
