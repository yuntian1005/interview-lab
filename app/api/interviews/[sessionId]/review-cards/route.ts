import { NextResponse } from "next/server";
import { getCurrentUser, unauthorizedResponse } from "@/lib/auth";
import { getUserSession, saveSession } from "@/lib/db";
import { hasDifyReviewConfig, sendDifyChatMessage } from "@/lib/dify";
import type { ReviewCard } from "@/lib/types";
import {
  buildPromptSecurityInstruction,
  detectPromptInjection,
  mergeSecurityFindings,
  wrapUntrustedContent
} from "@/lib/promptSecurity";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

type QuestionAnswerPair = {
  index: number;
  question: string;
  competency: string;
  answer: string;
  score: {
    content_score: number;
    logic_score: number;
  };
  evidence: string[];
  covered_anchors: string[];
  missing_anchors: string[];
  risks: string[];
};

export async function POST(request: Request, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) return unauthorizedResponse();

  const { sessionId } = await context.params;
  const session = await getUserSession(sessionId, user.user_id);

  if (!session) {
    return NextResponse.json({ error: "Interview session not found." }, { status: 404 });
  }

  const force = readForceFlag(request);
  if (!force && Array.isArray(session.review_cards) && session.review_cards.length) {
    return NextResponse.json({
      cards: session.review_cards,
      source: "cache",
      generated_at: session.review_cards_generated_at ?? null
    });
  }

  if (!hasDifyReviewConfig()) {
    return NextResponse.json({ error: "Dify review agent is not configured." }, { status: 501 });
  }

  const pairs = buildQuestionAnswerPairs(session);
  if (!pairs.length) {
    return NextResponse.json({ cards: [] });
  }
  const securityFindings = mergeSecurityFindings(
    ...pairs.map((pair) => detectPromptInjection(pair.answer, "answer"))
  );

  const query = [
    buildPromptSecurityInstruction(securityFindings),
    "",
    "请基于以下模拟面试问答，生成逐题复盘卡。",
    "",
    "输出要求：",
    "1. 只返回 JSON，不要 Markdown，不要代码块。",
    "2. JSON 顶层格式必须是 {\"cards\": [...]}。",
    "3. cards 每项字段必须包含：index、question、answer、summary、missingEvidence、betterAnswer、nextPractice。",
    "4. missingEvidence 必须是字符串数组，建议 2-4 条。",
    "5. betterAnswer 要给出可直接参考的改写示例，避免空泛建议。",
    "6. nextPractice 要给出下一轮可执行练习动作。",
    `7. 必须为问答数据中的每一项都生成一张卡片，cards.length 必须等于 ${pairs.length}。`,
    "",
    `目标岗位：${session.job_role ?? "目标岗位"}`,
    `岗位级别：${session.job_level}`,
    `难度：${session.difficulty ?? "中等"}`,
    "",
    "最终报告摘要：",
    wrapUntrustedContent("最终报告摘要", session.report?.report_markdown?.slice(0, 4000) || "暂无最终报告。"),
    "",
    "问答数据：",
    wrapUntrustedContent("问答数据JSON", JSON.stringify(pairs, null, 2))
  ].join("\n");

  const dify = await sendDifyChatMessage({
    user: `${session.session_id}_review_cards`,
    query,
    apiKey: process.env.DIFY_REVIEW_API_KEY || process.env.DIFY_REVIEW_AGENT_API_KEY,
    inputs: {
      job_role: session.job_role ?? "目标岗位",
      job_level: session.job_level,
      difficulty: session.difficulty ?? "中等",
      qa_pairs: JSON.stringify(pairs),
      report_markdown: session.report?.report_markdown ?? "",
      security_instruction: buildPromptSecurityInstruction(securityFindings)
    }
  });

  const cards = completeReviewCards(parseReviewCards(dify.answer), pairs);
  if (!cards.length) {
    return NextResponse.json({ error: "Dify review agent returned no valid cards.", raw: dify.answer }, { status: 502 });
  }

  const generatedAt = new Date().toISOString();
  await saveSession({
    ...session,
    review_cards: cards,
    review_cards_generated_at: generatedAt,
    updated_at: generatedAt
  });

  return NextResponse.json({ cards, source: "dify", generated_at: generatedAt });
}

function readForceFlag(request: Request) {
  try {
    return new URL(request.url).searchParams.get("force") === "1";
  } catch {
    return false;
  }
}

function buildQuestionAnswerPairs(session: any): QuestionAnswerPair[] {
  const questions = buildQuestionTimeline(session);

  return (session.turns ?? [])
    .filter((turn: any) => typeof turn.answer_text === "string" && turn.answer_text.trim())
    .map((turn: any, index: number) => {
      const question = session.question_plan?.find((item: any) => item.question_id === turn.question_id);
      const timelineQuestion = questions[index];

      return {
        index: index + 1,
        question: timelineQuestion || question?.question || "候选人补充回答",
        competency: question?.competency || "综合表现",
        answer: turn.answer_text,
        score: {
          content_score: turn.content_score,
          logic_score: turn.logic_score
        },
        evidence: Array.isArray(turn.evidence) ? turn.evidence : [],
        covered_anchors: Array.isArray(turn.covered_anchors) ? turn.covered_anchors : [],
        missing_anchors: Array.isArray(turn.missing_anchors) ? turn.missing_anchors : [],
        risks: Array.isArray(turn.risks) ? turn.risks : []
      };
    });
}

function buildQuestionTimeline(session: any) {
  const questions: string[] = [];
  const firstQuestion = session.question_plan?.[0]?.question;
  if (firstQuestion) {
    questions.push(firstQuestion);
  }

  for (const turn of session.turns ?? []) {
    if (turn.followup_question) {
      questions.push(turn.followup_question);
    }
  }

  return questions;
}

function parseReviewCards(answer: string): ReviewCard[] {
  const jsonText = extractJson(answer);
  if (!jsonText) return [];

  try {
    const payload = JSON.parse(jsonText) as { cards?: unknown };
    if (!Array.isArray(payload.cards)) return [];

    return payload.cards
      .map((item, index) => normalizeCard(item, index + 1))
      .filter(Boolean) as ReviewCard[];
  } catch {
    return [];
  }
}

function extractJson(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return "";
  return candidate.slice(start, end + 1);
}

function normalizeCard(item: unknown, fallbackIndex: number): ReviewCard | null {
  if (!item || typeof item !== "object") return null;
  const value = item as Record<string, unknown>;
  const question = readString(value.question);
  const answer = readString(value.answer);
  if (!question || !answer) return null;

  return {
    index: readNumber(value.index) || fallbackIndex,
    question,
    answer,
    summary: readString(value.summary) || answer.slice(0, 52),
    missingEvidence: readStringArray(value.missingEvidence).slice(0, 4),
    betterAnswer: readString(value.betterAnswer) || "建议按背景、行动、结果、复盘重新组织回答。",
    nextPractice: readString(value.nextPractice) || "下一轮练习时先列出 2 个关键动作和 1 个量化结果。"
  };
}

function completeReviewCards(cards: ReviewCard[], pairs: QuestionAnswerPair[]): ReviewCard[] {
  return pairs.map((pair, index) => {
    const card = cards.find((item) => item.index === pair.index) ?? cards[index];
    if (card && isSameAnswer(card.answer, pair.answer)) {
      return {
        ...card,
        index: pair.index,
        question: card.question || pair.question,
        answer: card.answer || pair.answer,
        missingEvidence: card.missingEvidence.length ? card.missingEvidence : buildFallbackMissingEvidence(pair)
      };
    }

    return buildFallbackCard(pair);
  });
}

function isSameAnswer(cardAnswer: string, pairAnswer: string) {
  const card = compactText(cardAnswer);
  const pair = compactText(pairAnswer);
  return Boolean(card && pair && (card === pair || pair.includes(card.slice(0, 40)) || card.includes(pair.slice(0, 40))));
}

function buildFallbackCard(pair: QuestionAnswerPair): ReviewCard {
  const missingEvidence = buildFallbackMissingEvidence(pair);

  return {
    index: pair.index,
    question: pair.question,
    answer: pair.answer,
    summary: summarizeAnswer(pair.answer),
    missingEvidence,
    betterAnswer: buildFallbackBetterAnswer(pair, missingEvidence),
    nextPractice: buildFallbackNextPractice(pair)
  };
}

function buildFallbackMissingEvidence(pair: QuestionAnswerPair) {
  const items = [...pair.missing_anchors, ...pair.risks].filter(Boolean);
  const answer = pair.answer;

  if (!/背景|目标|需求|问题|场景|项目|业务/.test(answer)) {
    items.push("缺少项目背景或业务场景，建议先说明当时要解决什么问题。");
  }
  if (!/负责|设计|搭建|分析|推进|协调|优化|完成|实现|解决|参与|主导/.test(answer)) {
    items.push("缺少你本人的具体动作，建议说明你负责了哪些关键步骤。");
  }
  if (!/结果|最终|产出|上线|落地|通过|获得|提升|降低|增长|转化|效率/.test(answer)) {
    items.push("缺少结果闭环，建议补充产出、影响或复盘结论。");
  }
  if (!/\d|%|百分|提升|降低|增长|减少|排名|top/i.test(answer)) {
    items.push("缺少量化证据，建议加入指标、规模、耗时或提升比例。");
  }

  return Array.from(new Set(items)).slice(0, 4);
}

function buildFallbackBetterAnswer(pair: QuestionAnswerPair, missingEvidence: string[]) {
  const focus = pair.question.length > 36 ? `${pair.question.slice(0, 36)}...` : pair.question;
  return [
    `可以围绕“${focus}”按背景、行动、结果、复盘重答：先说明这个场景的业务目标和约束，`,
    `再讲清楚你本人负责的关键动作，尤其突出${pair.competency || "岗位能力"}相关证据。`,
    missingEvidence.some((item) => item.includes("量化"))
      ? "最后补充一个可量化结果，例如处理规模、准确率、耗时、效率提升或业务反馈。"
      : "最后用已有结果说明方案价值，并补充一个复盘点。"
  ].join("");
}

function buildFallbackNextPractice(pair: QuestionAnswerPair) {
  if (pair.score.content_score > 0 && pair.score.content_score <= 2) {
    return "下一次先补齐背景、职责和结果，再展开技术或过程细节。";
  }
  if (pair.score.logic_score > 0 && pair.score.logic_score <= 2) {
    return "把这题按 STAR 结构重答一遍，并控制在 90 秒内。";
  }
  return "准备 2 个数字证据和 1 个复盘点，再用 90 秒重答这题。";
}

function summarizeAnswer(answer: string) {
  const normalized = answer.replace(/\s+/g, " ").trim();
  if (!normalized) return "本题回答较少，需要补充完整经历。";
  if (normalized.length <= 52) return normalized;
  return `${normalized.slice(0, 52)}...`;
}

function compactText(text: string) {
  return text.replace(/\s+/g, "").trim();
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => readString(item)).filter(Boolean);
}
