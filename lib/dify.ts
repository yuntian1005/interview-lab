import { isDemoMode } from "@/lib/runtimeMode";

export type DifyChatResponse = {
  conversation_id: string;
  message_id?: string;
  answer: string;
  metadata?: Record<string, unknown>;
};

type DifyFileInput = {
  type: "document" | "image" | "audio" | "video" | "custom";
  transfer_method: "local_file";
  upload_file_id: string;
};

export function hasDifyConfig(): boolean {
  return !isDemoMode() && Boolean(process.env.DIFY_API_KEY);
}

export function hasDifyReviewConfig(): boolean {
  return !isDemoMode() && Boolean(process.env.DIFY_REVIEW_API_KEY || process.env.DIFY_REVIEW_AGENT_API_KEY);
}

export function hasDifyResumeConfig(): boolean {
  return !isDemoMode() && Boolean(process.env.DIFY_RESUME_API_KEY || process.env.DIFY_RESUME_PARSER_API_KEY);
}

export function hasDifyJobRecommendConfig(): boolean {
  return !isDemoMode() && Boolean(process.env.DIFY_JOB_RECOMMEND_API_KEY || process.env.DIFY_JOB_AGENT_API_KEY);
}

export async function sendDifyChatMessage(input: {
  query: string;
  user: string;
  conversation_id?: string;
  inputs?: Record<string, unknown>;
  apiKey?: string;
  files?: DifyFileInput[];
}): Promise<DifyChatResponse> {
  const apiBase = process.env.DIFY_API_BASE || "https://api.dify.ai/v1";
  const apiKey = input.apiKey ?? process.env.DIFY_API_KEY;

  if (!apiKey) {
    throw new Error("DIFY_API_KEY is not configured.");
  }

  const startedAt = Date.now();
  const response = await fetch(`${apiBase.replace(/\/$/, "")}/chat-messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      inputs: input.inputs ?? {},
      query: input.query,
      response_mode: "blocking",
      conversation_id: input.conversation_id ?? "",
      user: input.user,
      files: input.files ?? []
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Dify chat failed: ${response.status} ${detail}`);
  }

  const payload = (await response.json()) as DifyChatResponse;
  console.log(`[dify] chat completed in ${Date.now() - startedAt}ms`);

  return {
    conversation_id: payload.conversation_id,
    message_id: payload.message_id,
    answer: payload.answer,
    metadata: payload.metadata
  };
}

export async function uploadDifyFile(input: {
  file: File;
  user: string;
  apiKey?: string;
}): Promise<{ id: string; name: string; size: number; mime_type: string }> {
  const apiBase = process.env.DIFY_API_BASE || "https://api.dify.ai/v1";
  const apiKey = input.apiKey ?? process.env.DIFY_API_KEY;

  if (!apiKey) {
    throw new Error("Dify file upload API key is not configured.");
  }

  const formData = new FormData();
  formData.append("file", input.file);
  formData.append("user", input.user);

  const response = await fetch(`${apiBase.replace(/\/$/, "")}/files/upload`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`
    },
    body: formData
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Dify file upload failed: ${response.status} ${detail}`);
  }

  return (await response.json()) as { id: string; name: string; size: number; mime_type: string };
}

export function looksLikeFinalReport(answer: string): boolean {
  const normalized = answer.replace(/\r/g, "\n");
  const hasReportTitle = /(?:^|\n)\s*#*\s*(?:AI\s*)?模拟面试报告\b/i.test(normalized);
  const hasReportSections =
    /(?:^|\n)\s*#{1,3}\s*(?:一[、.．]\s*)?整体结果\b/.test(normalized) &&
    /(?:^|\n)\s*#{1,3}\s*(?:二[、.．]\s*)?能力维度得分\b/.test(normalized);
  const hasFinalScore = extractScore(normalized) > 0;

  return hasReportTitle || hasReportSections || (hasFinalScore && /报告|整体结果|能力维度|核心优势|改进建议/.test(normalized));
}

export function extractScore(answer: string): number {
  const normalized = answer.replace(/[*_`#>\-\s]/g, "");
  const patterns = [
    /总分[:：]?(\d+(?:\.\d+)?)(?:\/|／)100/,
    /总分[:：]?(\d+(?:\.\d+)?)分(?:\/?100)?/,
    /总分[:：]?(\d+(?:\.\d+)?)(?:满分)?100/,
    /整体(?:得分|评分|分数)[:：]?(\d+(?:\.\d+)?)(?:\/|／)?100?/
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match) return clampScore(Number(match[1]));
  }

  return 0;
}

function clampScore(score: number) {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, Math.round(score)));
}
