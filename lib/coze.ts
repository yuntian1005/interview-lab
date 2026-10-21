import {
  EvaluateTurnResult,
  GenerateReportResult,
  PrepareInterviewResult,
  Turn
} from "@/lib/types";
import { mockEvaluateTurn, mockGenerateReport, mockPrepareInterview } from "@/lib/mockCoze";
import { isDemoMode } from "@/lib/runtimeMode";

type CozeWorkflowName = "prepare" | "evaluate" | "report";

const workflowIds: Record<CozeWorkflowName, string | undefined> = {
  prepare: process.env.COZE_PREPARE_WORKFLOW_ID,
  evaluate: process.env.COZE_EVALUATE_WORKFLOW_ID,
  report: process.env.COZE_REPORT_WORKFLOW_ID
};

function hasCozeConfig(name: CozeWorkflowName): boolean {
  return !isDemoMode() && Boolean(process.env.COZE_API_BASE && process.env.COZE_API_TOKEN && workflowIds[name]);
}

type CozeFileUploadResult = {
  id: string;
  file_name?: string;
  bytes?: number;
  created_at?: number;
};

type CozeResumeParseResult = {
  text: string;
  file_id: string;
  file_name: string;
  file_type: string;
  source: "coze";
};

async function runCozeWorkflow<T>(name: CozeWorkflowName, parameters: Record<string, unknown>): Promise<T> {
  if (!hasCozeConfig(name)) {
    throw new Error(`Coze workflow ${name} is not configured.`);
  }

  const response = await fetch(`${process.env.COZE_API_BASE}/v1/workflow/run`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.COZE_API_TOKEN}`
    },
    body: JSON.stringify({
      workflow_id: workflowIds[name],
      parameters
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Coze workflow ${name} failed: ${response.status} ${detail}`);
  }

  const payload = await response.json();
  const data = payload.data ?? payload;

  if (typeof data === "string") {
    return JSON.parse(data) as T;
  }

  if (typeof data?.output === "string") {
    return JSON.parse(data.output) as T;
  }

  return data as T;
}

function getCozeApiBase(): string | undefined {
  return process.env.COZE_API_BASE?.replace(/\/$/, "");
}

function hasCozeResumeParserConfig(): boolean {
  return !isDemoMode() && Boolean(getCozeApiBase() && process.env.COZE_API_TOKEN && process.env.COZE_RESUME_PARSER_WORKFLOW_ID);
}

function extractWorkflowOutputText(payload: unknown): string {
  const data = typeof payload === "object" && payload !== null && "data" in payload ? (payload as { data: unknown }).data : payload;

  if (typeof data === "string") {
    try {
      const parsed = JSON.parse(data) as unknown;
      return extractWorkflowOutputText(parsed);
    } catch {
      return data;
    }
  }

  if (typeof data === "object" && data !== null && "output" in data) {
    const output = (data as { output: unknown }).output;
    if (typeof output === "string") return output;
    return JSON.stringify(output);
  }

  return JSON.stringify(data ?? "");
}

async function uploadCozeFile(file: File): Promise<CozeFileUploadResult> {
  const apiBase = getCozeApiBase();
  if (!apiBase || !process.env.COZE_API_TOKEN) {
    throw new Error("Coze file upload is not configured.");
  }

  const formData = new FormData();
  formData.append("file", file, file.name);

  const response = await fetch(`${apiBase}/v1/files/upload`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.COZE_API_TOKEN}`
    },
    body: formData
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Coze file upload failed: ${response.status} ${detail}`);
  }

  const payload = await response.json();
  const data = payload.data ?? payload;
  if (!data?.id) {
    throw new Error("Coze file upload did not return a file id.");
  }

  return data as CozeFileUploadResult;
}

export async function parseResumeWithCoze(file: File): Promise<CozeResumeParseResult | null> {
  if (!hasCozeResumeParserConfig()) {
    return null;
  }

  const apiBase = getCozeApiBase();
  const uploaded = await uploadCozeFile(file);
  const fileInput = JSON.stringify({ file_id: uploaded.id });

  const response = await fetch(`${apiBase}/v1/workflow/run`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.COZE_API_TOKEN}`
    },
    body: JSON.stringify({
      workflow_id: process.env.COZE_RESUME_PARSER_WORKFLOW_ID,
      parameters: {
        input: fileInput
      }
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Coze resume parser failed: ${response.status} ${detail}`);
  }

  const text = extractWorkflowOutputText(await response.json()).trim();
  if (!text) {
    throw new Error("Coze resume parser returned empty output.");
  }

  return {
    text,
    file_id: uploaded.id,
    file_name: uploaded.file_name ?? file.name,
    file_type: file.type || "application/octet-stream",
    source: "coze"
  };
}

export async function prepareInterview(input: {
  resume_text: string;
  jd_text: string;
  job_level: string;
  interview_mode: string;
  language: string;
  question_count?: number;
}): Promise<PrepareInterviewResult> {
  if (!hasCozeConfig("prepare")) {
    return mockPrepareInterview(input);
  }

  return runCozeWorkflow<PrepareInterviewResult>("prepare", input);
}

export async function evaluateTurn(input: {
  session_id: string;
  question_id: string;
  question_text: string;
  competency: string;
  expected_anchors: string[];
  followup_targets: string[];
  answer_text: string;
  followup_count: number;
  max_followups: number;
  history: unknown[];
  audio_metrics: Record<string, unknown>;
  video_metrics: Record<string, unknown>;
}): Promise<EvaluateTurnResult> {
  if (!hasCozeConfig("evaluate")) {
    return mockEvaluateTurn(input);
  }

  return runCozeWorkflow<EvaluateTurnResult>("evaluate", input);
}

export async function generateReport(input: {
  candidate_profile: Record<string, unknown>;
  jd_profile: Record<string, unknown>;
  match_matrix: unknown[];
  question_plan: unknown[];
  turns: Turn[];
  audio_metrics_summary: Record<string, unknown>;
  video_metrics_summary: Record<string, unknown>;
}): Promise<GenerateReportResult> {
  if (!hasCozeConfig("report")) {
    return mockGenerateReport({ turns: input.turns });
  }

  return runCozeWorkflow<GenerateReportResult>("report", input);
}
