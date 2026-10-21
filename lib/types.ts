export type InterviewMode = "text" | "voice" | "video";
export type InterviewStatus = "created" | "ongoing" | "completed" | "failed";
export type TurnType = "main_answer" | "followup_answer";

export type Question = {
  question_id: string;
  question_type: string;
  question: string;
  competency: string;
  weight: number;
  expected_anchors: string[];
  followup_targets: string[];
  max_followups: number;
};

export type Turn = {
  turn_id: string;
  session_id: string;
  question_id: string;
  turn_type: TurnType;
  answer_text: string;
  content_score: number;
  logic_score: number;
  evidence: string[];
  covered_anchors: string[];
  missing_anchors: string[];
  risks: string[];
  followup_needed: boolean;
  followup_question: string;
  audio_metrics?: Record<string, unknown>;
  video_metrics?: Record<string, unknown>;
  created_at: string;
};

export type Report = {
  report_id: string;
  session_id: string;
  total_score: number;
  competency_scores: Record<string, number>;
  strengths: string[];
  risks: string[];
  improvements: string[];
  report_markdown: string;
  created_at: string;
};

export type ReviewCard = {
  index: number;
  question: string;
  answer: string;
  summary: string;
  missingEvidence: string[];
  betterAnswer: string;
  nextPractice: string;
};

export type InterviewSession = {
  session_id: string;
  user_id?: string;
  provider?: "mock" | "coze" | "dify";
  dify_conversation_id?: string;
  mode: InterviewMode;
  status: InterviewStatus;
  job_role?: string;
  interview_duration?: string;
  difficulty?: string;
  question_count?: number;
  resume_text: string;
  jd_text: string;
  job_level: string;
  language: string;
  candidate_profile: Record<string, unknown>;
  jd_profile: Record<string, unknown>;
  match_matrix: unknown[];
  question_plan: Question[];
  current_question_id: string;
  completed_question_ids: string[];
  turns: Turn[];
  report?: Report;
  review_cards?: ReviewCard[];
  review_cards_generated_at?: string;
  created_at: string;
  updated_at: string;
};

export type PrepareInterviewResult = {
  candidate_profile: Record<string, unknown>;
  jd_profile: Record<string, unknown>;
  match_matrix: unknown[];
  question_plan: Question[];
  first_question: string;
};

export type EvaluateTurnResult = {
  content_score: number;
  logic_score: number;
  evidence: string[];
  covered_anchors: string[];
  missing_anchors: string[];
  risks: string[];
  need_followup: boolean;
  followup_question: string;
  candidate_feedback_preview: string;
  next_action: "ask_followup" | "next_question";
};

export type GenerateReportResult = Omit<Report, "report_id" | "session_id" | "created_at">;
