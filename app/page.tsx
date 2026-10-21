"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { InterviewReview } from "@/components/interview/InterviewReview";
import { InterviewerAvatar } from "@/components/interview/InterviewerAvatar";
import { VideoInterviewStage } from "@/components/interview/VideoInterviewStage";
import { jobPresets, recommendJobs, type JobPreset } from "@/lib/jobPresets";
import { AvatarState, InterviewDisplayPhase, avatarStatusText } from "@/lib/interviewAvatar";

const AI_TTS_PLAYBACK_RATE = 1.1;
const VOICE_DETECTED_VOLUME = 0.018;
const AUTO_STOP_AFTER_SILENCE_MS = 6500;
const AUTO_STOP_MIN_RECORDING_MS = 8000;
const MAX_VOICE_RECORDING_MS = 120000;
const START_LISTENING_AFTER_TTS_MS = 900;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

type SpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

type BrowserSpeechRecognition = EventTarget & {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionErrorEvent = Event & {
  error: string;
};

type SpeechRecognitionEvent = Event & {
  resultIndex: number;
  results: SpeechRecognitionResultList;
};

type Question = {
  question_id: string;
  question: string;
  competency: string;
};

type ChatMessage = {
  role: "assistant" | "user";
  text: string;
  score?: {
    content_score: number;
    logic_score: number;
  };
  meta?: {
    competency?: string;
    evidence?: string[];
    missingAnchors?: string[];
    risks?: string[];
    source?: "draft" | "turn" | "report";
  };
};

type AnswerReviewCard = {
  index: number;
  question: string;
  answer: string;
  summary: string;
  missingEvidence: string[];
  betterAnswer: string;
  nextPractice: string;
};

type Report = {
  total_score: number;
  report_markdown: string;
  competency_scores?: Record<string, number>;
  strengths?: string[];
  risks?: string[];
  improvements?: string[];
};

type TurnEvaluation = {
  content_score: number;
  logic_score: number;
  evidence?: string[];
  missing_anchors?: string[];
  risks?: string[];
  competency?: string;
};

type LiveAssessmentMetric = {
  name: string;
  score: number;
  detail: string;
};

type RoomPhase = "idle" | "ai_speaking" | "listening" | "transcribing" | "thinking" | "completed";

type AudioMetrics = {
  duration_seconds: number;
  speech_rate_cpm: number;
  pause_count: number;
  silence_ratio: number;
  average_volume: number;
  fluency_score: number;
  filler_count: number;
  transcript_length: number;
  source: "server_asr" | "browser_asr" | "text";
};

type VideoMetrics = {
  camera_enabled: boolean;
  brightness: number | null;
  brightness_status: "not_collected" | "dark" | "normal" | "bright";
  stability_score: number | null;
  frame_change_count: number;
  sample_count: number;
};

type AudioMetricDraft = {
  sampleCount: number;
  volumeTotal: number;
  silentFrames: number;
  pauseCount: number;
  inPause: boolean;
  pauseStartedAt: number;
  recordingStartedAt: number;
};

type VideoMetricDraft = {
  sampleCount: number;
  brightnessTotal: number;
  frameChangeTotal: number;
  frameChangeCount: number;
  previousFrame?: Uint8ClampedArray;
};

type SessionSummary = {
  session_id: string;
  status: string;
  mode: "text" | "voice" | "video";
  job_role?: string;
  difficulty?: string;
  question_count?: number;
  report: { total_score: number; created_at: string } | null;
  created_at: string;
  updated_at: string;
};

type AuthUser = {
  user_id: string;
  username: string;
  created_at: string;
};

type ThemeMode = "dark" | "light";

const sampleJd =
  "数据分析师岗位，负责业务数据分析、指标体系建设、SQL 报表开发、增长策略支持。要求熟悉 SQL 和 Excel，具备良好的业务理解、逻辑表达和跨部门沟通能力。";

const icpBeian = process.env.NEXT_PUBLIC_ICP_BEIAN?.trim() || "";
const icpApprovedAt = process.env.NEXT_PUBLIC_ICP_APPROVED_AT?.trim() || "";
const publicSecurityBeian = process.env.NEXT_PUBLIC_PUBLIC_SECURITY_BEIAN?.trim() ?? "";
const publicSecurityCode = process.env.NEXT_PUBLIC_PUBLIC_SECURITY_CODE?.trim() ?? "";

export default function Home() {
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authUsername, setAuthUsername] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [themeMode, setThemeMode] = useState<ThemeMode>("dark");
  const [resumeText, setResumeText] = useState("");
  const [resumeFileName, setResumeFileName] = useState("");
  const [jdText, setJdText] = useState(sampleJd);
  const [selectedJobId, setSelectedJobId] = useState("data_analyst");
  const [customJobRole, setCustomJobRole] = useState("");
  const [jobLevel, setJobLevel] = useState("校招");
  const [interviewDuration, setInterviewDuration] = useState("10 分钟");
  const [difficulty, setDifficulty] = useState("中等");
  const [questionCount, setQuestionCount] = useState(5);
  const [interviewMode, setInterviewMode] = useState<"text" | "voice" | "video">("text");
  const [recommendations, setRecommendations] = useState<Array<JobPreset & { reason: string; score: number }>>([]);
  const [queryRecommendations, setQueryRecommendations] = useState<Array<JobPreset & { reason: string; score: number }>>([]);
  const [recommendationHint, setRecommendationHint] = useState("");
  const [queryRecommendationHint, setQueryRecommendationHint] = useState("");
  const [isRecommending, setIsRecommending] = useState(false);
  const [isQueryingJobs, setIsQueryingJobs] = useState(false);
  const [recommendKeyword, setRecommendKeyword] = useState("Java 后端");
  const [recommendLimit, setRecommendLimit] = useState(5);
  const [sessionId, setSessionId] = useState("");
  const [currentQuestion, setCurrentQuestion] = useState<Question | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [answer, setAnswer] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [turnType, setTurnType] = useState<"main_answer" | "followup_answer">("main_answer");
  const [showParsedResume, setShowParsedResume] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [speechHint, setSpeechHint] = useState("");
  const [asrPreview, setAsrPreview] = useState("");
  const [audioMetrics, setAudioMetrics] = useState<AudioMetrics | null>(null);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [cameraHint, setCameraHint] = useState("");
  const [videoBrightness, setVideoBrightness] = useState<number | null>(null);
  const [videoMetrics, setVideoMetrics] = useState<VideoMetrics | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [timeLeftSeconds, setTimeLeftSeconds] = useState<number | null>(null);
  const [roomPhase, setRoomPhase] = useState<RoomPhase>("idle");
  const [avatarState, setAvatarState] = useState<AvatarState>("idle");
  const [displayPhase, setDisplayPhase] = useState<InterviewDisplayPhase>("config");
  const [callAccepted, setCallAccepted] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [autoVoiceFlow, setAutoVoiceFlow] = useState(true);
  const [history, setHistory] = useState<SessionSummary[]>([]);
  const [historyHint, setHistoryHint] = useState("");
  const [turnEvaluations, setTurnEvaluations] = useState<TurnEvaluation[]>([]);
  const [difyReviewCards, setDifyReviewCards] = useState<AnswerReviewCard[] | null>(null);
  const [isGeneratingReviewCards, setIsGeneratingReviewCards] = useState(false);
  const [reviewCardsHint, setReviewCardsHint] = useState("");
  const [shouldUseLocalReviewCards, setShouldUseLocalReviewCards] = useState(false);

  const speechBaseRef = useRef("");
  const speechFinalRef = useRef("");
  const speechResultMapRef = useRef(new Map<number, { text: string; isFinal: boolean }>());
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Float32Array[]>([]);
  const audioSampleRateRef = useRef(44100);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const lastSpokenTextRef = useRef("");
  const aiSpeechFallbackTimerRef = useRef<number | null>(null);
  const aiSpeechCompletedRef = useRef(false);
  const isListeningRef = useRef(false);
  const heardVoiceRef = useRef(false);
  const stoppingRecordingRef = useRef(false);
  const discardSpeechRecognitionRef = useRef(false);
  const recordingStartedAtRef = useRef(0);
  const lastVoiceAtRef = useRef(0);
  const audioMetricDraftRef = useRef<AudioMetricDraft>(createAudioMetricDraft());
  const videoMetricDraftRef = useRef<VideoMetricDraft>(createVideoMetricDraft());

  const statusText = useMemo(() => {
    if (displayPhase === "review") return "面试回顾";
    if (displayPhase === "report" && report) return "报告已生成";
    if (sessionId) return "面试进行中";
    return "准备创建";
  }, [displayPhase, report, sessionId]);

  const selectedJobName = useMemo(() => {
    if (selectedJobId === "custom") return customJobRole.trim() || "自定义岗位";
    return jobPresets.find((job) => job.id === selectedJobId)?.name ?? "目标岗位";
  }, [customJobRole, selectedJobId]);

  const progressIndex = useMemo(() => {
    if (report) return questionCount;
    const answeredCount = messages.filter((message) => message.role === "user").length;
    return Math.min(questionCount, Math.max(sessionId ? 1 : 0, answeredCount + (currentQuestion ? 1 : 0)));
  }, [currentQuestion, messages, questionCount, report, sessionId]);

  const answerReviewCards = useMemo(() => buildAnswerReviewCards(messages, selectedJobName), [messages, selectedJobName]);
  const visibleAnswerReviewCards = difyReviewCards?.length
    ? difyReviewCards
    : shouldUseLocalReviewCards
      ? answerReviewCards
      : [];
  const latestUserAnswer = useMemo(() => {
    const latestUserMessage = [...messages].reverse().find((message) => message.role === "user")?.text;
    return answer.trim() || asrPreview.trim() || latestUserMessage || "";
  }, [answer, asrPreview, messages]);

  const latestAnswerAnalysis = useMemo(
    () => (latestUserAnswer ? analyzeAnswerEvidence(latestUserAnswer, selectedJobName) : null),
    [latestUserAnswer, selectedJobName]
  );

  const assessmentScores = useMemo(
    () => buildLiveAssessmentMetrics({ report, turnEvaluations, latestAnswerAnalysis }),
    [latestAnswerAnalysis, report, turnEvaluations]
  );

  const suggestionItems = useMemo(
    () =>
      buildSidebarSuggestions({
        report,
        latestAnswerAnalysis,
        turnEvaluations,
        currentQuestion,
        progressIndex,
        questionCount,
        roomPhase
      }),
    [currentQuestion, latestAnswerAnalysis, progressIndex, questionCount, report, roomPhase, turnEvaluations]
  );

  const assessmentSourceText = useMemo(() => {
    if (report) return "来源：最终面试报告";
    if (latestUserAnswer) return "来源：当前回答与历史作答";
    if (turnEvaluations.length) return "来源：已完成题目的即时评分";
    return "来源：开始作答后动态生成";
  }, [latestUserAnswer, report, turnEvaluations.length]);

  const processingText = useMemo(() => {
    if (isLoading && roomPhase === "thinking") return "AI 面试官正在分析回答并生成追问...";
    if (isLoading) return "正在处理，请稍候...";
    if (roomPhase === "transcribing") return "正在识别语音...";
    if (roomPhase === "listening") return "正在聆听候选人回答...";
    if (roomPhase === "ai_speaking") return "AI 面试官正在提问...";
    return "";
  }, [isLoading, roomPhase]);

  const isCallMode = interviewMode !== "text";
  const isStealthInterview = isCallMode && displayPhase === "interviewing" && Boolean(sessionId) && !report;
  const showIncomingCall = isCallMode && Boolean(sessionId) && displayPhase === "interviewing" && !report && !callAccepted && messages.length > 0;
  const progressText = `第 ${progressIndex} / ${questionCount} 题`;

  useEffect(() => {
    void loadCurrentUser();
  }, []);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("ai-ms-theme");
    if (savedTheme === "light" || savedTheme === "dark") {
      setThemeMode(savedTheme);
      document.body.dataset.theme = savedTheme;
      return;
    }

    const prefersLight = window.matchMedia?.("(prefers-color-scheme: light)").matches;
    const initialTheme: ThemeMode = prefersLight ? "light" : "dark";
    setThemeMode(initialTheme);
    document.body.dataset.theme = initialTheme;
  }, []);

  function toggleThemeMode() {
    const nextTheme: ThemeMode = themeMode === "dark" ? "light" : "dark";
    setThemeMode(nextTheme);
    document.body.dataset.theme = nextTheme;
    window.localStorage.setItem("ai-ms-theme", nextTheme);
  }

  useEffect(() => {
    isListeningRef.current = isListening;
  }, [isListening]);

  useEffect(() => {
    if (interviewMode !== "video") {
      stopCamera();
    }

    return () => {
      stopCamera();
    };
  }, [interviewMode]);

  useEffect(() => {
    if (!sessionId || report) return;
    if (interviewMode !== "voice" && interviewMode !== "video") return;
    if (!autoSpeak) return;
    if (!callAccepted) return;

    const latestAssistant = [...messages].reverse().find((message) => message.role === "assistant")?.text;
    if (!latestAssistant || latestAssistant === lastSpokenTextRef.current) return;

    lastSpokenTextRef.current = latestAssistant;
    speakText(latestAssistant, { silentError: true });
  }, [autoSpeak, callAccepted, interviewMode, messages, report, sessionId]);

  useEffect(() => {
    if (selectedJobId === "custom") {
      setJdText("");
      return;
    }

    const preset = jobPresets.find((job) => job.id === selectedJobId);
    if (preset) {
      setJdText(preset.jd);
    }
  }, [selectedJobId]);

  useEffect(() => {
    if (interviewMode !== "video" || !isCameraOn) return;

    const timer = window.setInterval(sampleVideoBrightness, 2500);
    return () => window.clearInterval(timer);
  }, [interviewMode, isCameraOn]);

  useEffect(() => {
    if (!sessionId || report || timeLeftSeconds === null || timeLeftSeconds <= 0) return;

    const timer = window.setInterval(() => {
      setTimeLeftSeconds((value) => (value === null ? value : Math.max(0, value - 1)));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [sessionId, report, timeLeftSeconds]);

  useEffect(() => {
    if (displayPhase !== "report" || !sessionId || !report || difyReviewCards) return;
    void generateDifyReviewCards();
  }, [difyReviewCards, displayPhase, report, sessionId]);

  async function loadCurrentUser() {
    setIsCheckingAuth(true);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 1000);

    try {
      const response = await fetch("/api/auth/me", { cache: "no-store", signal: controller.signal });
      const payload = await parseJsonResponse(response);
      const user = payload.user ?? null;
      setCurrentUser(user);
      if (user) {
        void loadHistory();
      }
    } catch {
      setCurrentUser(null);
    } finally {
      setIsCheckingAuth(false);
    }
  }

  function resetReviewCardsState() {
    setDifyReviewCards(null);
    setReviewCardsHint("");
    setShouldUseLocalReviewCards(false);
  }

  async function requireFreshLogin() {
    setIsAuthLoading(true);
    setCurrentUser(null);
    setCallAccepted(false);
    setHistory([]);
    setSessionId("");
    setMessages([]);
    setReport(null);
    setTurnEvaluations([]);
    resetReviewCardsState();
    setCurrentQuestion(null);
    setAnswer("");

    try {
      await fetch("/api/auth/logout", { method: "POST", cache: "no-store" });
    } finally {
      setIsAuthLoading(false);
    }
  }

  async function submitAuth(event: FormEvent) {
    event.preventDefault();
    setIsCheckingAuth(false);
    setIsAuthLoading(true);
    setAuthError("");
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(`/api/auth/${authMode}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          username: authUsername,
          password: authPassword
        })
      });
      const payload = await parseJsonResponse(response);

      if (!response.ok) {
        throw new Error(typeof payload.error === "string" ? payload.error : "账号操作失败");
      }

      setCurrentUser(payload.user);
      setAuthPassword("");
      setHistoryHint("");
      void loadHistory();
    } catch (err) {
      setAuthError(err instanceof DOMException && err.name === "AbortError" ? "登录响应超时，请再点一次登录。" : err instanceof Error ? err.message : "账号操作失败");
    } finally {
      window.clearTimeout(timeoutId);
      setIsAuthLoading(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setCurrentUser(null);
    setCallAccepted(false);
    setHistory([]);
    setSessionId("");
    setMessages([]);
    setReport(null);
    setTurnEvaluations([]);
    resetReviewCardsState();
    setCurrentQuestion(null);
    setAnswer("");
    setDisplayPhase("config");
    setAvatarState("idle");
    setRoomPhase("idle");
  }

  async function createInterview(event: FormEvent) {
    event.preventDefault();
    if (!currentUser) {
      setError("请先登录后再开始面试。");
      return;
    }
    if (resumeText.trim().length < 20) {
      setShowParsedResume(true);
      setError("请上传简历或粘贴至少 20 个字的简历内容。");
      return;
    }
    if (jdText.trim().length < 20) {
      setError("岗位 JD 不能为空，请填写至少 20 个字的岗位职责和要求。");
      return;
    }
    setIsLoading(true);
    setError("");
    setReport(null);
    setTurnEvaluations([]);
    resetReviewCardsState();
    setDisplayPhase("config");
    setAvatarState("thinking");

    try {
      const response = await fetch("/api/interviews", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          resume_text: resumeText.trim(),
          jd_text: jdText.trim(),
          mode: interviewMode,
          job_level: jobLevel,
          job_role:
            selectedJobId === "custom"
              ? customJobRole || "自定义岗位"
              : jobPresets.find((job) => job.id === selectedJobId)?.name ?? "自定义岗位",
          interview_duration: interviewDuration,
          difficulty,
          question_count: questionCount,
          language: "zh-CN"
        })
      });
      const payload = await parseJsonResponse(response);

      if (!response.ok) {
        throw new Error(JSON.stringify(payload.error ?? payload));
      }

      setSessionId(payload.session_id);
      setCurrentQuestion(payload.current_question);
      setMessages([{ role: "assistant", text: payload.first_question }]);
      setTurnEvaluations([]);
      resetReviewCardsState();
      setTurnType("main_answer");
      setAnswer("");
      setTimeLeftSeconds(durationToSeconds(interviewDuration));
      setCallAccepted(interviewMode === "text");
      setRoomPhase("idle");
      setAvatarState("idle");
      setDisplayPhase("interviewing");
      lastSpokenTextRef.current = "";
      void loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建面试失败");
    } finally {
      setIsLoading(false);
    }
  }

  async function parseResumeFile(file: File) {
    setIsLoading(true);
    setError("");

    try {
      const formData = new FormData();
      formData.append("resume_file", file);
      const response = await fetch("/api/resume/parse", { method: "POST", body: formData });
      const payload = await parseJsonResponse(response);

      if (!response.ok) {
        throw new Error(readErrorMessage(payload.error, "简历解析失败"));
      }

      setResumeText(payload.text);
      setResumeFileName(payload.file_name);
      setShowParsedResume(true);
      void updateRecommendations(payload.text);
    } catch (err) {
      setError(err instanceof Error ? err.message : "简历解析失败");
    } finally {
      setIsLoading(false);
    }
  }

  async function submitAnswer(event: FormEvent) {
    event.preventDefault();
    await submitAnswerText(answer, turnType);
  }

  async function submitAnswerText(text: string, type: typeof turnType) {
    if (!sessionId || !currentQuestion || !text.trim()) return;
    const nextAudioMetrics = audioMetrics ?? estimateTextAudioMetrics(text, interviewMode === "text" ? "text" : "browser_asr");
    const nextVideoMetrics = getCurrentVideoMetrics();
    const currentCompetency = currentQuestion.competency;
    setIsLoading(true);
    setError("");
    setRoomPhase("thinking");
    setAvatarState("thinking");
    setMessages((items) => [...items, { role: "user", text }]);

    try {
      const response = await fetch(`/api/interviews/${sessionId}/turns`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question_id: currentQuestion.question_id,
          answer_text: text,
          turn_type: type,
          audio_metrics: nextAudioMetrics,
          video_metrics: nextVideoMetrics
        })
      });
      const payload = await parseJsonResponse(response);

      if (!response.ok) {
        throw new Error(JSON.stringify(payload.error ?? payload));
      }

      const turnEvaluation = normalizeTurnEvaluation(payload.turn, currentCompetency);
      if (turnEvaluation) {
        setTurnEvaluations((items) => [...items, turnEvaluation]);
        setMessages((items) => attachLatestUserScore(items, turnEvaluation));
      }

      setAnswer("");
      if (payload.should_generate_report || payload.report) {
        const rawReport = payload.report ?? {
          total_score: payload.total_score ?? 0,
          report_markdown: payload.report_markdown ?? payload.message ?? ""
        };
        const nextReport = {
          ...rawReport,
          report_markdown: withDeviceNotes(rawReport.report_markdown, {
            mode: interviewMode,
            audio: nextAudioMetrics,
            video: nextVideoMetrics
          })
        };
        setReport(mergeReportPayload(nextReport, payload.report));
        setCurrentQuestion(null);
        setRoomPhase("completed");
        setAvatarState("idle");
        setDisplayPhase("review");
        if (payload.message) {
          setMessages((items) => [...items, { role: "assistant", text: payload.message }]);
        }
        void loadHistory();
        return;
      }

      setCurrentQuestion(payload.current_question ?? currentQuestion);
      setTurnType(payload.turn_type ?? "main_answer");
      setAudioMetrics(null);
      if (payload.message) {
        setMessages((items) => [
          ...items,
          {
            role: "assistant",
            text: payload.message,
            meta: {
              competency: payload.current_question?.competency ?? currentCompetency,
              evidence: turnEvaluation?.evidence,
              missingAnchors: turnEvaluation?.missing_anchors,
              risks: turnEvaluation?.risks,
              source: "turn"
            }
          }
        ]);
        setRoomPhase(interviewMode === "text" ? "idle" : "ai_speaking");
        setAvatarState(interviewMode === "text" ? "idle" : "thinking");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交回答失败");
      setRoomPhase("idle");
      setAvatarState("error");
    } finally {
      setIsLoading(false);
    }
  }

  async function loadHistory() {
    try {
      const response = await fetch("/api/interviews", { cache: "no-store" });
      const payload = await parseJsonResponse(response);
      if (!response.ok) {
        throw new Error(payload.error ?? "历史记录加载失败");
      }
      setHistory(payload.sessions ?? []);
    } catch {
      setHistoryHint("历史记录暂时无法加载，不影响当前面试。");
    }
  }

  async function openHistorySession(nextSessionId: string) {
    setIsLoading(true);
    setError("");
    setHistoryHint("");

    try {
      const response = await fetch(`/api/interviews/${nextSessionId}`, { cache: "no-store" });
      const payload = await parseJsonResponse(response);
      if (!response.ok) {
        throw new Error(payload.error ?? "历史面试加载失败");
      }

      const session = payload.session;
      setSessionId(session.session_id);
      setInterviewMode(session.mode ?? "text");
      setJobLevel(session.job_level ?? "校招");
      setDifficulty(session.difficulty ?? "中等");
      setInterviewDuration(session.interview_duration ?? "10 分钟");
      setQuestionCount(session.question_count ?? 5);
      setCurrentQuestion(payload.current_question);
      setTurnType("main_answer");
      setAnswer("");
      setTimeLeftSeconds(null);
      setRoomPhase(session.status === "completed" ? "completed" : "idle");
      setAvatarState(session.status === "completed" ? "idle" : "idle");
      setCallAccepted((session.mode ?? "text") === "text" || session.status === "completed");
      setMessages(buildMessagesFromSession(session));
      setTurnEvaluations(buildTurnEvaluationsFromSession(session));
      setReport(session.report ? mergeReportPayload(session.report, session.report) : null);
      const savedReviewCards = normalizeReviewCardsPayload(session.review_cards);
      setDifyReviewCards(savedReviewCards.length ? savedReviewCards : null);
      setShouldUseLocalReviewCards(false);
      setReviewCardsHint(savedReviewCards.length ? "已加载上次生成的智能复盘卡。" : "");
      setDisplayPhase(session.status === "completed" && session.report ? "review" : "interviewing");
      setHistoryHint(session.report ? "已打开历史报告。" : "已打开历史面试，可继续查看当前进度。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "历史面试加载失败");
    } finally {
      setIsLoading(false);
    }
  }

  async function deleteHistorySession(nextSessionId: string) {
    if (!window.confirm("确定删除这条历史练习记录吗？删除后不能恢复。")) return;

    setHistoryHint("");
    setError("");

    try {
      const response = await fetch(`/api/interviews/${nextSessionId}`, { method: "DELETE" });
      const payload = await parseJsonResponse(response);
      if (!response.ok) {
        throw new Error(payload.error ?? "删除历史记录失败");
      }

      setHistory((items) => items.filter((item) => item.session_id !== nextSessionId));
      setHistoryHint("历史记录已删除。");
      if (nextSessionId === sessionId) {
        setSessionId("");
        setCurrentQuestion(null);
        setMessages([]);
        setReport(null);
        setTurnEvaluations([]);
        resetReviewCardsState();
        setAnswer("");
        setRoomPhase("idle");
        setAvatarState("idle");
        setDisplayPhase("config");
        setCallAccepted(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除历史记录失败");
    }
  }

  async function generateDifyReviewCards(force = false) {
    if (!sessionId || !report || isGeneratingReviewCards) return;
    if (difyReviewCards && !force) return;

    setIsGeneratingReviewCards(true);
    setShouldUseLocalReviewCards(false);
    if (force) {
      setDifyReviewCards(null);
    }
    setReviewCardsHint(force ? "正在重新生成智能复盘卡..." : "正在生成智能复盘卡...");

    try {
      const response = await fetch(`/api/interviews/${sessionId}/review-cards${force ? "?force=1" : ""}`, {
        method: "POST",
        cache: "no-store"
      });
      const payload = await parseJsonResponse(response);

      if (!response.ok) {
        throw new Error(typeof payload.error === "string" ? payload.error : "智能复盘卡生成失败");
      }

      const cards = normalizeReviewCardsPayload(payload.cards);
      if (!cards.length) {
        throw new Error("智能体没有返回有效复盘卡");
      }

      setDifyReviewCards(cards);
      setShouldUseLocalReviewCards(false);
      setReviewCardsHint(payload.source === "cache" ? "已加载上次生成的智能复盘卡。" : "已由复盘智能体生成。");
    } catch {
      setDifyReviewCards(null);
      setShouldUseLocalReviewCards(true);
      setReviewCardsHint("复盘智能体暂不可用，当前显示本地复盘卡。");
    } finally {
      setIsGeneratingReviewCards(false);
    }
  }

  async function requestStageReport() {
    if (!sessionId || !currentQuestion || isLoading) return;
    await submitAnswerText("请结束本次面试，并基于当前已完成内容生成阶段性模拟面试报告。", turnType);
  }

  function getCurrentVideoMetrics(cameraEnabled = isCameraOn): VideoMetrics {
    return makeVideoMetricsSnapshot({
      cameraEnabled,
      brightness: videoBrightness,
      draft: videoMetricDraftRef.current
    });
  }

  function answerIncomingCall() {
    setCallAccepted(true);
    setRoomPhase("ai_speaking");
    if (interviewMode === "video") {
      void startCamera();
    }

    const latestAssistant = [...messages].reverse().find((message) => message.role === "assistant")?.text;
    if (latestAssistant) {
      lastSpokenTextRef.current = latestAssistant;
      void speakText(latestAssistant, { silentError: true });
    }
  }

  function declineIncomingCall() {
    setCallAccepted(false);
    setSessionId("");
    setCurrentQuestion(null);
    setMessages([]);
    setTurnEvaluations([]);
    resetReviewCardsState();
    setAnswer("");
    setAsrPreview("");
    setSpeechHint("");
    setRoomPhase("idle");
    stopCamera();
  }

  function downloadReportMarkdown() {
    if (!report) return;
    const blob = new Blob([report.report_markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `AI模拟面试报告_${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function printReport() {
    window.print();
  }

  function toggleSpeechInput() {
    if (typeof window === "undefined") return;

    if (isListening) {
      void stopServerSpeechRecognition();
      return;
    }

    stopInterviewerSpeech();
    void startServerSpeechRecognition();
  }

  async function startServerSpeechRecognition() {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      startBrowserSpeechRecognition();
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1
        },
        video: false
      });
      const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) {
        stream.getTracks().forEach((track) => track.stop());
        startBrowserSpeechRecognition();
        return;
      }

      const audioContext = new AudioContextClass();
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);

      audioChunksRef.current = [];
      audioSampleRateRef.current = audioContext.sampleRate;
      speechBaseRef.current = answer.trim();
      discardSpeechRecognitionRef.current = false;
      heardVoiceRef.current = false;
      stoppingRecordingRef.current = false;
      recordingStartedAtRef.current = Date.now();
      lastVoiceAtRef.current = Date.now();
      audioMetricDraftRef.current = createAudioMetricDraft(recordingStartedAtRef.current);
      setAsrPreview("");
      setAudioMetrics(null);

      processor.onaudioprocess = (event) => {
        const input = event.inputBuffer.getChannelData(0);
        audioChunksRef.current.push(new Float32Array(input));

        const volume = rms(input);
        const now = Date.now();
        updateAudioMetricDraft(audioMetricDraftRef.current, volume, now);
        if (volume > VOICE_DETECTED_VOLUME) {
          heardVoiceRef.current = true;
          lastVoiceAtRef.current = now;
        }

        if (
          autoVoiceFlow &&
          heardVoiceRef.current &&
          !stoppingRecordingRef.current &&
          now - recordingStartedAtRef.current > MAX_VOICE_RECORDING_MS
        ) {
          stoppingRecordingRef.current = true;
          void stopServerSpeechRecognition({ autoSubmit: true });
          return;
        }

        if (
          autoVoiceFlow &&
          heardVoiceRef.current &&
          !stoppingRecordingRef.current &&
          now - recordingStartedAtRef.current > AUTO_STOP_MIN_RECORDING_MS &&
          now - lastVoiceAtRef.current > AUTO_STOP_AFTER_SILENCE_MS
        ) {
          stoppingRecordingRef.current = true;
          void stopServerSpeechRecognition({ autoSubmit: true });
        }
      };

      source.connect(processor);
      processor.connect(audioContext.destination);

      audioContextRef.current = audioContext;
      audioProcessorRef.current = processor;
      audioSourceRef.current = source;
      audioStreamRef.current = stream;
      setIsListening(true);
      setRoomPhase("listening");
      setAvatarState("listening");
      setSpeechHint(
        autoVoiceFlow
          ? "正在聆听。请靠近麦克风回答，连续停顿约 3 秒后系统会自动识别并提交；长回答可直接继续说。"
          : "正在录音，说完后点击“停止识别”。系统会调用服务端 ASR 转成文字，你可以编辑后再提交给 Dify。"
      );
    } catch {
      startBrowserSpeechRecognition();
    }
  }

  async function stopServerSpeechRecognition(options?: { autoSubmit?: boolean }) {
    if (!audioContextRef.current) {
      recognitionRef.current?.stop();
      return;
    }

    stoppingRecordingRef.current = true;
    setIsListening(false);
    setRoomPhase("transcribing");
    setAvatarState("thinking");
    setSpeechHint("正在识别语音，请稍候...");

    const chunks = audioChunksRef.current;
    const sampleRate = audioSampleRateRef.current;
    cleanupAudioRecording();

    try {
      const wav = encodeWav(chunks, sampleRate, 16000);
      if (wav.size < 1200) {
        throw new Error("录音太短，请至少说 1 秒后再停止识别。");
      }

      let transcript = await transcribeAnswerAudio(wav, "/api/asr/xfyun");
      const recordingSeconds = audioMetricDraftRef.current.recordingStartedAt
        ? Math.round((Date.now() - audioMetricDraftRef.current.recordingStartedAt) / 1000)
        : 0;

      if (isSuspiciouslyShortTranscript(transcript, recordingSeconds)) {
        setSpeechHint("识别结果偏短，正在尝试备用语音识别...");
        try {
          const backupTranscript = await transcribeAnswerAudio(wav, "/api/asr/spark");
          if (countChineseLikeChars(backupTranscript) > countChineseLikeChars(transcript)) {
            transcript = backupTranscript;
          }
        } catch {
          // Keep the primary ASR result if the backup service is unavailable.
        }
      }
      if (!transcript) {
        throw new Error("未识别到文字，可以重试或直接文字输入。");
      }

      const nextMetrics = finalizeAudioMetrics(audioMetricDraftRef.current, transcript, "server_asr");
      setAudioMetrics(nextMetrics);
      setAsrPreview(transcript);
      const nextAnswer = [speechBaseRef.current, transcript].filter(Boolean).join("\n");
      setAnswer(nextAnswer);
      if ((options?.autoSubmit || autoVoiceFlow) && sessionId && currentQuestion && nextAnswer.trim()) {
        setSpeechHint("已识别完成，正在自动提交给 Dify。");
        await submitAnswerText(nextAnswer, turnType);
        return;
      }

      setSpeechHint("语音识别已完成，可以编辑后点击“提交回答”。");
      setRoomPhase("idle");
    } catch (err) {
      setSpeechHint(err instanceof Error ? `${err.message} 可改用文字输入继续 Dify 面试。` : "语音识别失败，可改用文字输入继续 Dify 面试。");
      setRoomPhase("idle");
      setAvatarState("error");
    }
  }

  function cleanupAudioRecording() {
    audioProcessorRef.current?.disconnect();
    audioSourceRef.current?.disconnect();
    audioStreamRef.current?.getTracks().forEach((track) => track.stop());
    void audioContextRef.current?.close();
    audioContextRef.current = null;
    audioProcessorRef.current = null;
    audioSourceRef.current = null;
    audioStreamRef.current = null;
    stoppingRecordingRef.current = false;
  }

  function cancelSpeechRecognition(reason?: string) {
    stoppingRecordingRef.current = true;
    discardSpeechRecognitionRef.current = true;
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    cleanupAudioRecording();
    setIsListening(false);
    setRoomPhase("idle");
    setAvatarState("idle");
    if (reason) setSpeechHint(reason);
  }

  function startBrowserSpeechRecognition() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!Recognition) {
      setSpeechHint("当前浏览器不支持普通语音识别。建议使用最新版 Chrome 或 Edge，或直接使用文字输入。");
      return;
    }

    const recognition = new Recognition();
    speechBaseRef.current = answer.trim();
    speechFinalRef.current = "";
    discardSpeechRecognitionRef.current = false;
    speechResultMapRef.current.clear();

    recognition.lang = "zh-CN";
    recognition.interimResults = true;
    recognition.continuous = true;

    recognition.onstart = () => {
      audioMetricDraftRef.current = createAudioMetricDraft(Date.now());
      setAudioMetrics(null);
      setIsListening(true);
      setRoomPhase("listening");
      setAvatarState("listening");
      setSpeechHint(
        autoVoiceFlow
          ? "正在使用浏览器语音识别。说完后保持短暂停顿，系统会自动提交。"
          : "正在使用浏览器语音识别。你可以说完后停止识别，再编辑提交。"
      );
    };

    recognition.onresult = (event) => {
      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index];
        const text = result[0]?.transcript?.trim() ?? "";

        if (text) {
          speechResultMapRef.current.set(index, { text, isFinal: result.isFinal });
        }
      }

      const orderedResults = Array.from(speechResultMapRef.current.entries()).sort(([left], [right]) => left - right);
      const finalText = orderedResults
        .filter(([, item]) => item.isFinal)
        .map(([, item]) => item.text)
        .join("");
      const interimText = orderedResults
        .filter(([, item]) => !item.isFinal)
        .map(([, item]) => item.text)
        .join("");
      speechFinalRef.current = finalText;

      const transcript = compactRepeatedSpeech(`${finalText}${interimText}`).trim();
      if (!transcript) return;

      setAsrPreview(transcript);
      setAnswer([speechBaseRef.current, transcript].filter(Boolean).join("\n"));
    };

    recognition.onerror = (event) => {
      setIsListening(false);
      recognitionRef.current = null;
      setRoomPhase("idle");
      setAvatarState("error");
      setSpeechHint(browserSpeechErrorMessage(event.error));
    };

    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
      setRoomPhase("idle");
      setAvatarState("idle");
      if (discardSpeechRecognitionRef.current) {
        discardSpeechRecognitionRef.current = false;
        speechFinalRef.current = "";
        speechResultMapRef.current.clear();
        return;
      }
      const transcript = compactRepeatedSpeech(speechFinalRef.current);
      if (transcript) {
        setAudioMetrics(finalizeAudioMetrics(audioMetricDraftRef.current, transcript, "browser_asr"));
      }
      const nextAnswer = [speechBaseRef.current, transcript].filter(Boolean).join("\n");
      if (autoVoiceFlow && sessionId && currentQuestion && nextAnswer.trim()) {
        setSpeechHint("语音识别已完成，正在自动提交给 Dify。");
        void submitAnswerText(nextAnswer, turnType);
        return;
      }
      setSpeechHint(transcript ? "语音识别已结束，可以编辑后提交。" : "语音识别已结束，未识别到文字。");
    };

    recognitionRef.current = recognition;
    recognition.start();
  }

  async function updateRecommendations(nextResumeText = resumeText) {
    const hasResume = nextResumeText.trim().length >= 20;

    if (!hasResume) {
      setRecommendationHint("请先上传或填写简历内容，再使用智能推荐。");
      return;
    }

    setIsRecommending(true);
    setRecommendationHint("正在根据简历匹配岗位库...");
    setError("");

    try {
      const response = await fetch("/api/jobs/recommend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          resume_text: nextResumeText,
          limit: recommendLimit,
          keyword: ""
        })
      });
      const payload = await parseJsonResponse(response);

      if (!response.ok) {
        throw new Error(payload.error ?? "岗位推荐失败");
      }

      setRecommendations(payload.recommendations ?? []);
      setRecommendationHint(payload.hint || "已找到岗位，可点击推荐卡片应用岗位 JD。");
    } catch (err) {
      const nextRecommendations = recommendJobs(nextResumeText, recommendLimit);
      setRecommendations(nextRecommendations);
      setRecommendationHint("岗位库暂时没有返回结果，已为你生成基础岗位建议。");
    } finally {
      setIsRecommending(false);
    }
  }

  async function queryJobsByKeyword() {
    const keyword = recommendKeyword.trim();
    if (!keyword) {
      setQueryRecommendationHint("请输入想查询的岗位名称。");
      return;
    }

    setIsQueryingJobs(true);
    setQueryRecommendationHint("正在按岗位名称查询岗位库...");

    try {
      const response = await fetch("/api/jobs/recommend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          resume_text: "",
          limit: 5,
          keyword
        })
      });
      const payload = await parseJsonResponse(response);

      if (!response.ok) {
        throw new Error(payload.error ?? "岗位查询失败");
      }

      setQueryRecommendations(payload.recommendations ?? []);
      setQueryRecommendationHint(payload.hint || "已按岗位名称查询到相关 JD。");
    } catch (err) {
      setQueryRecommendations([]);
      setQueryRecommendationHint("岗位库暂时没有查到相关岗位，请换一个岗位名称试试。");
    } finally {
      setIsQueryingJobs(false);
    }
  }

  function applyRecommendation(job: JobPreset) {
    setSelectedJobId(job.id);
    setCustomJobRole("");
    setJdText(job.jd);
    setRecommendationHint(`已应用推荐岗位：${job.name}`);
  }

  function speakLatestQuestion() {
    const latestAssistant = [...messages].reverse().find((message) => message.role === "assistant");
    if (!latestAssistant) {
      setSpeechHint("暂无可朗读的问题。");
      return;
    }

    if (isListeningRef.current || audioContextRef.current || recognitionRef.current) {
      cancelSpeechRecognition("已停止当前录音，避免把 AI 播报内容录进回答。");
    }

    speakText(latestAssistant.text);
  }

  function handleAiSpeechEnded() {
    if (aiSpeechCompletedRef.current) return;
    aiSpeechCompletedRef.current = true;
    if (aiSpeechFallbackTimerRef.current !== null) {
      window.clearTimeout(aiSpeechFallbackTimerRef.current);
      aiSpeechFallbackTimerRef.current = null;
    }
    setIsSpeaking(false);
    setRoomPhase("idle");
    setAvatarState("idle");
    if (autoVoiceFlow && interviewMode !== "text" && currentQuestion && !report && !isLoading && !isListeningRef.current) {
      window.setTimeout(() => {
        if (!isListeningRef.current && !audioContextRef.current && !recognitionRef.current) {
          void startServerSpeechRecognition();
        }
      }, START_LISTENING_AFTER_TTS_MS);
    }
  }

  function stopInterviewerSpeech() {
    aiSpeechCompletedRef.current = true;
    if (aiSpeechFallbackTimerRef.current !== null) {
      window.clearTimeout(aiSpeechFallbackTimerRef.current);
      aiSpeechFallbackTimerRef.current = null;
    }
    ttsAudioRef.current?.pause();
    ttsAudioRef.current = null;
    if (typeof window !== "undefined") {
      window.speechSynthesis?.cancel();
    }
    setIsSpeaking(false);
    setRoomPhase("idle");
    setAvatarState("idle");
  }

  async function speakText(text: string, options?: { silentError?: boolean }) {
    if (typeof window === "undefined") {
      if (!options?.silentError) setSpeechHint("当前浏览器不支持语音播报。");
      return;
    }

    if (isListeningRef.current || audioContextRef.current || recognitionRef.current) {
      cancelSpeechRecognition("已停止当前录音，避免把 AI 播报内容录进回答。");
    }

    if (isSpeaking) {
      stopInterviewerSpeech();
      return;
    }

    setAvatarState("thinking");
    const speechText = cleanSpeechText(text);
    aiSpeechCompletedRef.current = false;
    if (aiSpeechFallbackTimerRef.current !== null) {
      window.clearTimeout(aiSpeechFallbackTimerRef.current);
      aiSpeechFallbackTimerRef.current = null;
    }
    try {
      const response = await fetch("/api/tts/spark", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: speechText })
      });

      if (response.ok) {
        const audioBlob = await response.blob();
        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);
        audio.playbackRate = AI_TTS_PLAYBACK_RATE;
        ttsAudioRef.current = audio;
        audio.onplay = () => {
          setIsSpeaking(true);
          setRoomPhase("ai_speaking");
          setAvatarState("speaking");
          const fallbackMs = estimateSpeechDurationMs(speechText) / AI_TTS_PLAYBACK_RATE + 1200;
          aiSpeechFallbackTimerRef.current = window.setTimeout(handleAiSpeechEnded, fallbackMs);
        };
        audio.onended = () => {
          URL.revokeObjectURL(audioUrl);
          ttsAudioRef.current = null;
          handleAiSpeechEnded();
        };
        audio.onerror = () => {
          URL.revokeObjectURL(audioUrl);
          ttsAudioRef.current = null;
          setAvatarState("error");
          playBrowserSpeech(speechText, options);
        };
        await audio.play();
        return;
      }
    } catch {
      // Fall back to browser speech synthesis below.
    }

    playBrowserSpeech(speechText, options);
  }

  function playBrowserSpeech(text: string, options?: { silentError?: boolean }) {
    if (!window.speechSynthesis) {
      if (!options?.silentError) setSpeechHint("当前浏览器不支持语音播报。");
      return;
    }

    const utterance = new SpeechSynthesisUtterance(cleanSpeechText(text));
    utterance.lang = "zh-CN";
    utterance.rate = AI_TTS_PLAYBACK_RATE;
    utterance.onstart = () => {
      setRoomPhase("ai_speaking");
      setAvatarState("speaking");
      const fallbackMs = estimateSpeechDurationMs(text) / AI_TTS_PLAYBACK_RATE + 1200;
      aiSpeechFallbackTimerRef.current = window.setTimeout(handleAiSpeechEnded, fallbackMs);
    };
    utterance.onend = handleAiSpeechEnded;
    utterance.onerror = () => {
      setIsSpeaking(false);
      setRoomPhase("idle");
      setAvatarState("error");
      if (!options?.silentError) setSpeechHint("语音播报失败，可以继续使用文字阅读。");
    };
    setIsSpeaking(true);
    window.speechSynthesis.speak(utterance);
  }

  async function startCamera() {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setCameraHint("当前浏览器不支持摄像头调用，建议使用 Chrome 或 Edge。");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
        audio: false
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setIsCameraOn(true);
      videoMetricDraftRef.current = createVideoMetricDraft();
      setVideoMetrics({
        camera_enabled: true,
        brightness: null,
        brightness_status: "not_collected",
        stability_score: null,
        frame_change_count: 0,
        sample_count: 0
      });
      setCameraHint("摄像头已开启。当前版本只做本地预览，不上传原始视频。");
    } catch (err) {
      setIsCameraOn(false);
      setCameraHint(err instanceof Error ? cameraErrorMessage(err.name) : "摄像头开启失败。");
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setIsCameraOn(false);
    setVideoBrightness(null);
    setVideoMetrics(getCurrentVideoMetrics(false));
  }

  function sampleVideoBrightness() {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return;
    const canvas = document.createElement("canvas");
    canvas.width = 80;
    canvas.height = 45;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let total = 0;
    for (let index = 0; index < data.length; index += 4) {
      total += (data[index] + data[index + 1] + data[index + 2]) / 3;
    }
    const brightness = Math.round((total / (data.length / 4) / 255) * 100);
    const nextMetrics = updateVideoMetricDraft(videoMetricDraftRef.current, data, brightness, true);
    setVideoBrightness(brightness);
    setVideoMetrics(nextMetrics);
  }

  if (!currentUser) {
    return (
      <main className="shell auth-shell">
        <form className="panel auth-card" onSubmit={submitAuth}>
          <div className="brand auth-brand">
            <h1>AI 模拟面试系统</h1>
            <p>登录后你的简历、面试记录和报告只保存在自己的账号下。</p>
          </div>

          <div className="auth-tabs">
            <button className={authMode === "login" ? "active" : ""} type="button" onClick={() => setAuthMode("login")}>
              登录
            </button>
            <button className={authMode === "register" ? "active" : ""} type="button" onClick={() => setAuthMode("register")}>
              注册
            </button>
          </div>

          <div className="field">
            <label htmlFor="auth-username">用户名</label>
            <input
              id="auth-username"
              type="text"
              value={authUsername}
              onChange={(event) => {
                setIsCheckingAuth(false);
                setAuthUsername(event.target.value);
              }}
              placeholder="3-24位，小写字母/数字/下划线"
              autoComplete="username"
            />
          </div>

          <div className="field">
            <label htmlFor="auth-password">密码</label>
            <input
              id="auth-password"
              type="password"
              value={authPassword}
              onChange={(event) => {
                setIsCheckingAuth(false);
                setAuthPassword(event.target.value);
              }}
              placeholder="至少6位"
              autoComplete={authMode === "login" ? "current-password" : "new-password"}
            />
          </div>

          <button className="primary" disabled={isAuthLoading || !authUsername.trim() || !authPassword.trim()}>
            {isAuthLoading ? "处理中..." : authMode === "login" ? "登录" : "注册并登录"}
          </button>
          {isCheckingAuth ? (
            <div className="hint">
              正在尝试恢复登录态。如果一直没有自动进入，可以直接输入账号登录。
              <button className="text-button" type="button" onClick={() => setIsCheckingAuth(false)}>
                跳过检查
              </button>
            </div>
          ) : null}
          {authError ? <div className="error">{authError}</div> : null}
        </form>
      </main>
    );
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="topbar-brand">
          <span className="logo-mark" aria-hidden="true" />
          <div>
            <strong>Interview Lab</strong>
            <span>OPEN SOURCE</span>
          </div>
        </div>
        <div className="topbar-actions">
          <button className="secondary compact theme-toggle" type="button" onClick={toggleThemeMode}>
            {themeMode === "dark" ? "浅色模式" : "深色模式"}
          </button>
          <button className="secondary compact" type="button" onClick={loadHistory}>
            面试记录
          </button>
          <span className="avatar-badge">{currentUser.username.slice(0, 1).toUpperCase()}</span>
        </div>
      </header>
      <div className="app">
        <form className="panel setup" onSubmit={createInterview}>
          <div className="brand">
            <div className="user-bar">
              <span>当前用户：{currentUser.username}</span>
              <button className="text-button" type="button" onClick={logout}>
                退出登录
              </button>
            </div>
            <h1>面试配置</h1>
            <p>上传或粘贴真实简历内容，系统会根据岗位 JD 生成个性化模拟面试。</p>
          </div>

          <div className="field">
            <label htmlFor="resume-file">简历文件</label>
            <input
              id="resume-file"
              type="file"
              accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void parseResumeFile(file);
              }}
            />
            <div className="upload-state">
              {resumeFileName ? `已解析：${resumeFileName}` : "支持 PDF、DOCX、TXT。也可以直接粘贴简历内容。"}
            </div>
            <button className="text-button" type="button" onClick={() => setShowParsedResume((value) => !value)}>
              {showParsedResume ? "收起简历内容" : "查看/修改简历内容"}
            </button>
            {showParsedResume ? (
              <>
                <div className="upload-state">以下内容将用于岗位推荐、面试提问和报告分析，请确认是你的真实简历内容。</div>
                <textarea
                  id="resume"
                  value={resumeText}
                  onChange={(event) => setResumeText(event.target.value)}
                  placeholder="请粘贴你的真实简历内容，例如专业背景、项目经历、实习经历、技能、求职方向等。"
                />
              </>
            ) : null}
          </div>

          <div className="field">
            <label htmlFor="job-preset">目标岗位</label>
            <select id="job-preset" value={selectedJobId} onChange={(event) => setSelectedJobId(event.target.value)}>
              {jobPresets.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.name}
                </option>
              ))}
              <option value="custom">其他自定义岗位</option>
            </select>
            {selectedJobId === "custom" ? (
              <input
                type="text"
                value={customJobRole}
                onChange={(event) => setCustomJobRole(event.target.value)}
                placeholder="请输入自定义岗位名称，如 区块链开发工程师"
              />
            ) : null}
            <section className="recommend-panel">
              <div className="recommend-panel-head">
                <div>
                  <strong>智能推荐岗位</strong>
                  <span>先根据你的简历匹配岗位库里的真实 JD</span>
                </div>
                <select value={recommendLimit} onChange={(event) => setRecommendLimit(Number(event.target.value))}>
                  <option value={5}>5 个</option>
                  <option value={10}>10 个</option>
                </select>
              </div>
              <p className="recommend-disclaimer">
                岗位信息来自公开网络岗位库，用于模拟面试练习参考；内容未逐条人工审核，请以招聘平台原始信息和企业官方发布为准。
              </p>
              <button className="primary recommend-primary-action" type="button" onClick={() => void updateRecommendations(resumeText)} disabled={isRecommending}>
                {isRecommending ? "正在匹配岗位..." : "根据简历智能推荐"}
              </button>
            </section>
            {recommendationHint ? <div className="upload-state">{recommendationHint}</div> : null}
            {recommendations.length > 0 ? (
              <section className="recommend-result-panel">
                <div className="section-title-row">
                  <h2>推荐岗位</h2>
                  <span className="upload-state">点击后会填入下方岗位名称和 JD，请自行核对岗位真实性</span>
                </div>
                <div className="recommendations">
                  {recommendations.map((job) => (
                    <button className="recommendation" type="button" key={job.id} onClick={() => applyRecommendation(job)}>
                      <strong>
                        {job.name}
                        {job.score > 10 ? ` · 匹配 ${job.score} 分` : job.score > 0 ? ` · 匹配 ${job.score} 项` : " · 备选"}
                      </strong>
                      <span>{job.reason}</span>
                    </button>
                  ))}
                </div>
                <div className="recommend-query-card">
                  <div className="recommend-query-intro">
                    <strong>推荐不合适？按岗位名称补充查询</strong>
                    <span>这里不会覆盖简历智能推荐逻辑，只是帮你从岗位库里按名称检索更想练习的 JD。</span>
                  </div>
                  <label htmlFor="recommend-keyword">想查询的岗位名称</label>
                  <div className="recommend-search">
                    <input
                      id="recommend-keyword"
                      type="text"
                      value={recommendKeyword}
                      onChange={(event) => setRecommendKeyword(event.target.value)}
                      placeholder="例如：Java 后端、AI 产品经理、数据分析"
                    />
                  <button className="secondary compact" type="button" onClick={() => void queryJobsByKeyword()} disabled={isQueryingJobs}>
                    {isQueryingJobs ? "查询中..." : "查询岗位"}
                  </button>
                </div>
                {queryRecommendationHint ? <div className="upload-state">{queryRecommendationHint}</div> : null}
                {queryRecommendations.length > 0 ? (
                  <div className="recommendations keyword-recommendations">
                    {queryRecommendations.map((job) => (
                      <button className="recommendation" type="button" key={job.id} onClick={() => applyRecommendation(job)}>
                        <strong>
                          {job.name}
                          {job.score > 10 ? ` · 匹配 ${job.score} 分` : job.score > 0 ? ` · 匹配 ${job.score} 项` : " · 备选"}
                        </strong>
                        <span>{job.reason}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </section>
            ) : null}
          </div>

          <div className="field">
            <label htmlFor="jd">岗位 JD</label>
            <textarea id="jd" value={jdText} onChange={(event) => setJdText(event.target.value)} />
          </div>

          <div className="form-row">
            <div className="field">
              <label htmlFor="level">岗位级别</label>
              <select id="level" value={jobLevel} onChange={(event) => setJobLevel(event.target.value)}>
                <option>实习生</option>
                <option>校招</option>
                <option>社招初级</option>
                <option>中级</option>
                <option>高级</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="mode">模式</label>
              <select id="mode" value={interviewMode} onChange={(event) => setInterviewMode(event.target.value as "text" | "voice" | "video")}>
                <option value="text">文字面试</option>
                <option value="voice">语音输入面试</option>
                <option value="video">实时语音视频面试</option>
              </select>
            </div>
          </div>

          <div className="form-row three">
            <div className="field">
              <label htmlFor="duration">面试时长</label>
              <select id="duration" value={interviewDuration} onChange={(event) => setInterviewDuration(event.target.value)}>
                <option>5 分钟</option>
                <option>10 分钟</option>
                <option>15 分钟</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="difficulty">题目难度</label>
              <select id="difficulty" value={difficulty} onChange={(event) => setDifficulty(event.target.value)}>
                <option>基础</option>
                <option>中等</option>
                <option>挑战</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="question-count">题目数量</label>
              <select id="question-count" value={questionCount} onChange={(event) => setQuestionCount(Number(event.target.value))}>
                <option value={3}>3 题</option>
                <option value={5}>5 题</option>
                <option value={8}>8 题</option>
              </select>
            </div>
          </div>

          <div className="field">
            <label>普通语音识别测试</label>
            <button className={`secondary ${isListening ? "recording" : ""}`} type="button" onClick={toggleSpeechInput} disabled={isLoading}>
              {isListening ? "停止识别" : "开始语音识别"}
            </button>
            {speechHint ? <div className="upload-state">{speechHint}</div> : null}
            {asrPreview ? <div className="upload-state">识别结果：{asrPreview}</div> : null}
            {audioMetrics ? <div className="upload-state">{formatAudioMetrics(audioMetrics)}</div> : null}
          </div>

          <button className="primary" disabled={isLoading}>
            {isLoading ? "处理中..." : sessionId ? "重新生成题目并开始" : "生成面试题并开始"}
          </button>
          {error ? <div className="error">{error}</div> : null}

          <section className="history-panel">
            <div className="section-title-row">
              <h2>历史练习</h2>
              <button className="text-button" type="button" onClick={loadHistory}>
                刷新
              </button>
            </div>
            {historyHint ? <div className="upload-state">{historyHint}</div> : null}
            {history.length ? (
              <div className="history-list">
                {history.slice(0, 6).map((item) => (
                  <div className={`history-item ${item.session_id === sessionId ? "active" : ""}`} key={item.session_id}>
                    <button className="history-open" type="button" onClick={() => void openHistorySession(item.session_id)}>
                      <span>
                        {modeLabel(item.mode)} · {item.status === "completed" ? "已完成" : "进行中"}
                      </span>
                      <strong>{item.report ? `${item.report.total_score} 分` : "暂无报告"}</strong>
                      <small>{formatDateTime(item.created_at)}</small>
                    </button>
                    <button className="history-delete" type="button" onClick={() => void deleteHistorySession(item.session_id)}>
                      删除
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="upload-state">暂无历史记录，完成一次面试后会显示在这里。</div>
            )}
          </section>
        </form>

        <section className="panel workspace">
          <header className="workspace-header">
            <div>
              <h2>{statusText}</h2>
              <p>{sessionId ? `会话：${sessionId}` : "创建面试后，这里会显示 AI 面试官问题。"}</p>
            </div>
            <div className="header-actions">
              {interviewMode !== "text" ? (
                <>
                  <label className="toggle-line">
                    <input type="checkbox" checked={autoSpeak} onChange={(event) => setAutoSpeak(event.target.checked)} />
                    自动播报
                  </label>
                  <label className="toggle-line">
                    <input type="checkbox" checked={autoVoiceFlow} onChange={(event) => setAutoVoiceFlow(event.target.checked)} />
                    自动接话
                  </label>
                </>
              ) : null}
              <span className="status-pill">{statusText}</span>
            </div>
          </header>

          {sessionId && !report ? (
            <div className="interview-meta">
              <span>难度：{difficulty}</span>
              <span>题目：{questionCount} 题</span>
              <span>时长：{interviewDuration}</span>
              <span className={timeLeftSeconds === 0 ? "time-ended" : ""}>剩余：{formatDuration(timeLeftSeconds)}</span>
              <button className="text-button" type="button" onClick={requestStageReport} disabled={isLoading || !currentQuestion}>
                生成阶段报告
              </button>
            </div>
          ) : null}

          {processingText ? <div className="process-banner">{processingText}</div> : null}

          <div className="progress-strip" aria-label="面试进度">
            <div>
              <span>面试进度</span>
              <strong>{progressIndex} / {questionCount}</strong>
            </div>
            <div className="progress-rail">
              {Array.from({ length: questionCount }).map((_, index) => (
                <i className={index < progressIndex ? "active" : ""} key={index}>
                  {index + 1}
                </i>
              ))}
            </div>
          </div>

          <div className={`chat ${showIncomingCall ? "call-stage" : ""} ${isStealthInterview ? "stealth-chat" : ""}`}>
            {showIncomingCall ? (
              <div className="incoming-call-screen">
                <div className="incoming-glow" aria-hidden="true" />
                <div className="incoming-avatar">
                  <div className="avatar-shell" aria-hidden="true">
                    <div className="avatar-head">
                      <span className="avatar-eye left" />
                      <span className="avatar-eye right" />
                      <span className="avatar-mouth" />
                    </div>
                    <div className="avatar-body" />
                  </div>
                </div>
                <div className="incoming-copy">
                  <span>{interviewMode === "video" ? "视频面试来电" : "语音面试来电"}</span>
                  <h3>AI 面试官</h3>
                  <p>{selectedJobName} · {questionCount} 题 · {interviewDuration}</p>
                </div>
                <div className="incoming-rings" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </div>
                <div className="incoming-actions">
                  <button className="call-button decline" type="button" onClick={declineIncomingCall}>
                    拒绝
                  </button>
                  <button className="call-button answer" type="button" onClick={answerIncomingCall}>
                    接听
                  </button>
                </div>
              </div>
            ) : isStealthInterview && interviewMode === "video" ? (
              <VideoInterviewStage
                localVideoRef={videoRef}
                isCameraOn={isCameraOn}
                avatarState={avatarState}
                avatarName="AI 面试官"
                statusText={avatarStatusText[avatarState]}
                progressText={progressText}
                cameraError={cameraHint || null}
                onToggleCamera={isCameraOn ? stopCamera : startCamera}
                videoMetrics={{
                  brightness: videoBrightness,
                  stabilityScore: videoMetrics?.stability_score ?? null
                }}
              />
            ) : isStealthInterview ? (
              <div className="voice-interview-stage">
                <InterviewerAvatar state={avatarState} displayName="AI 面试官" />
                <div className="voice-stage-status">
                  <strong>{avatarStatusText[avatarState]}</strong>
                  <span>{progressText} · {formatDuration(timeLeftSeconds)}</span>
                </div>
              </div>
            ) : null}

            {!showIncomingCall && !isStealthInterview && messages.length === 0 ? (
              <div className="empty">
                <div>
                  <strong>先创建一场面试</strong>
                  <span>请先上传或粘贴真实简历内容，再生成面试。</span>
                </div>
              </div>
            ) : !showIncomingCall && !isStealthInterview ? (
              messages.map((message, index) => (
                <div className={`message ${message.role}`} key={`${message.role}-${index}`}>
                  <div className="message-label">{message.role === "assistant" ? "AI 面试官" : "候选人"}</div>
                  <div className="bubble">{message.text}</div>
                  {message.score ? (
                    <div className="score-preview">
                      本轮预览：内容 {message.score.content_score}/4，逻辑 {message.score.logic_score}/4
                    </div>
                  ) : null}
                </div>
              ))
            ) : null}
          </div>

          {showIncomingCall ? null : displayPhase === "review" ? (
            <InterviewReview
              messages={messages}
              questionCount={questionCount}
              reportReady={Boolean(report)}
              onShowReport={() => setDisplayPhase("report")}
            />
          ) : displayPhase === "report" && report ? (
            <div className="report">
              <div className="report-title-row">
                <h3>面试报告</h3>
                <div className="action-group">
                  <button className="secondary" type="button" onClick={downloadReportMarkdown}>
                    下载 Markdown
                  </button>
                  <button className="secondary" type="button" onClick={printReport}>
                    打印 / 另存 PDF
                  </button>
                </div>
              </div>
              <div className="report-overview">
                <div className="total-score">
                  <span>{report.total_score}</span>
                  <small>总分 / 100</small>
                </div>
                <div className="dimension-grid">
                  {extractDimensionScores(report.report_markdown).map((item) => (
                    <div className="dimension-card" key={item.name}>
                      <span>{item.name}</span>
                      <strong>
                        {item.score} / {item.max}
                      </strong>
                      <div className="mini-bar">
                        <i style={{ width: `${Math.min(100, (item.score / item.max) * 100)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              {visibleAnswerReviewCards.length || isGeneratingReviewCards ? (
                <section className="answer-review-section">
                  <div className="section-title-row">
                    <h3>逐题复盘卡</h3>
                    <div className="action-group">
                      <span className="hint">
                        {reviewCardsHint || "基于本次问答自动整理，用于下一轮练习"}
                      </span>
                      <button
                        className="secondary compact"
                        type="button"
                        onClick={() => void generateDifyReviewCards(true)}
                        disabled={isGeneratingReviewCards}
                      >
                        {isGeneratingReviewCards ? "生成中..." : "智能生成"}
                      </button>
                    </div>
                  </div>
                  {visibleAnswerReviewCards.length ? (
                    <div className="answer-review-grid">
                    {visibleAnswerReviewCards.map((card) => (
                      <article className="answer-review-card" key={`${card.index}-${card.question.slice(0, 16)}`}>
                        <div className="answer-review-card-head">
                          <span>第 {card.index} 题</span>
                          <strong>{card.summary}</strong>
                        </div>
                        <div className="answer-review-question">
                          <b>面试官问题</b>
                          <p>{card.question}</p>
                        </div>
                        <details className="answer-review-answer">
                          <summary>你的回答</summary>
                          <p>{card.answer || "本题未记录到用户回答。"}</p>
                        </details>
                        <div className="answer-review-block">
                          <b>缺少的证据</b>
                          <ul>
                            {card.missingEvidence.map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        </div>
                        <div className="answer-review-block">
                          <b>更好的回答示例</b>
                          <p>{card.betterAnswer}</p>
                        </div>
                        <div className="answer-review-block">
                          <b>下一次练习建议</b>
                          <p>{card.nextPractice}</p>
                        </div>
                      </article>
                    ))}
                    </div>
                  ) : (
                    <div className="upload-state">智能复盘卡正在生成中，请稍等片刻...</div>
                  )}
                </section>
              ) : null}
              <div className="markdown report-body">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{report.report_markdown}</ReactMarkdown>
              </div>
            </div>
          ) : (
            <form className={`composer ${interviewMode !== "text" ? "call-composer" : ""}`} onSubmit={submitAnswer}>
              {interviewMode !== "text" ? (
                <div className="call-console">
                  <div className="call-orb-wrap">
                    <div className={`call-orb phase-${roomPhase} ${isListening ? "listening" : ""} ${isSpeaking ? "speaking" : ""}`}>
                      <span />
                      <span />
                      <strong>{isSpeaking ? "AI" : isListening ? "你" : "AI"}</strong>
                    </div>
                    <div className="call-status-copy">
                      <strong>{roomPhaseLabel(roomPhase)}</strong>
                      <span>
                        {isListening
                          ? "近距离回答，连续停顿约 3 秒后自动提交。建议佩戴耳麦，减少旁人声音进入。"
                          : isSpeaking
                            ? "AI 面试官正在播报问题。"
                            : isLoading
                              ? "正在生成追问，请稍候。"
                              : "等待下一轮通话状态。"}
                      </span>
                    </div>
                  </div>

                  <div className="noise-note">
                    {audioMetrics
                      ? formatAudioMetrics(audioMetrics)
                      : "已开启降噪、回声消除和单声道收音。正式面试过程中不显示问答字幕。"}
                  </div>

                  <div className="call-controls">
                    <button className="secondary" type="button" disabled={!messages.length || isLoading} onClick={speakLatestQuestion}>
                      {isSpeaking ? "停止播报" : "重播问题"}
                    </button>
                    <button
                      className={`secondary ${isListening ? "recording" : ""}`}
                      type="button"
                      disabled={!currentQuestion || isLoading}
                      onClick={toggleSpeechInput}
                    >
                      {isListening ? "结束本轮回答" : "开始说话"}
                    </button>
                    <button className="secondary" type="button" disabled={!answer.trim() || isLoading} onClick={() => setAnswer("")}>
                      重新回答
                    </button>
                    {interviewMode === "video" ? (
                      <button className="secondary" type="button" onClick={isCameraOn ? stopCamera : startCamera}>
                        {isCameraOn ? "关闭摄像头" : "开启摄像头"}
                      </button>
                    ) : null}
                    <button className="secondary danger-action" type="button" onClick={requestStageReport} disabled={isLoading || !currentQuestion}>
                      结束并生成报告
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <textarea
                    value={answer}
                    onChange={(event) => setAnswer(event.target.value)}
                    placeholder={currentQuestion ? "输入你的回答..." : "创建面试后即可回答"}
                    disabled={!currentQuestion || isLoading}
                  />
                  <div className="composer-actions">
                    <span className="hint">
                      {currentQuestion ? `当前题：${currentQuestion.question_id} · ${currentQuestion.competency}` : "等待面试开始"}
                    </span>
                    <div className="action-group">
                      <button className="secondary" type="button" disabled={!messages.length || isLoading} onClick={speakLatestQuestion}>
                        {isSpeaking ? "停止播报" : "朗读问题"}
                      </button>
                      <button className="secondary" disabled={!currentQuestion || !answer.trim() || isLoading}>
                        {isLoading ? "处理中..." : "提交回答"}
                      </button>
                    </div>
                  </div>
                </>
              )}
              {speechHint ? <div className="speech-hint">{speechHint}</div> : null}
            </form>
          )}
        </section>

        <aside className="panel interviewer-panel">
          <div className="interviewer-header">
            <strong>AI 面试官</strong>
            <span>AI INTERVIEWER</span>
          </div>
          <InterviewerAvatar state={avatarState} displayName="AI 面试官" className="side-avatar" />

          <section className="insight-card">
            <h3>实时评估维度</h3>
            <p className="insight-note">{assessmentSourceText}</p>
            {assessmentScores.map((item) => (
              <div className="metric-row" key={item.name}>
                <div>
                  <span>{item.name}</span>
                  <strong>{report || turnEvaluations.length || latestUserAnswer ? `${item.score}/100` : "待作答"}</strong>
                </div>
                <div className="mini-bar">
                  <i style={{ width: report || turnEvaluations.length || latestUserAnswer ? `${item.score}%` : "0%" }} />
                </div>
                <small className="metric-detail">{item.detail}</small>
              </div>
            ))}
          </section>

          <section className="insight-card">
            <h3>面试建议</h3>
            <ul className="suggestion-list">
              {suggestionItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        </aside>
      </div>

      <footer className="site-footer">
        <div className="statusbar">
          <span><i className="dot online" />网络状态 良好</span>
          <span>语音识别 {interviewMode === "text" ? "未启用" : isListening ? "识别中" : "已就绪"}</span>
          <span>自动保存 已开启</span>
        </div>
        <div className="legalbar" aria-label="网站备案与法律信息">
          <span>© 2026 AI 模拟面试系统</span>
          {icpBeian ? (
            <a href="https://beian.miit.gov.cn/" target="_blank" rel="noreferrer">
              {icpBeian}
            </a>
          ) : null}
          {publicSecurityBeian ? (
            <a
              href={
                publicSecurityCode
                  ? `https://www.beian.gov.cn/portal/registerSystemInfo?recordcode=${publicSecurityCode}`
                  : "https://www.beian.gov.cn/"
              }
              target="_blank"
              rel="noreferrer"
            >
              {publicSecurityBeian}
            </a>
          ) : null}
          {icpApprovedAt && <span>备案审核通过日期：{icpApprovedAt}</span>}
          <a href="/privacy" target="_blank" rel="noreferrer">
            隐私政策
          </a>
          <a href="/terms" target="_blank" rel="noreferrer">
            用户协议
          </a>
        </div>
      </footer>
    </main>
  );
}

function durationToSeconds(duration: string) {
  const minutes = Number(duration.match(/\d+/)?.[0] ?? 10);
  return minutes * 60;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "--:--";
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes()
  ).padStart(2, "0")}`;
}

function modeLabel(mode: "text" | "voice" | "video") {
  const labels = {
    text: "文字",
    voice: "语音",
    video: "视频"
  };
  return labels[mode] ?? "面试";
}

function attachLatestUserScore(messages: ChatMessage[], turn: TurnEvaluation): ChatMessage[] {
  const nextMessages = [...messages];

  for (let index = nextMessages.length - 1; index >= 0; index -= 1) {
    const message = nextMessages[index];
    if (message.role !== "user") continue;

    nextMessages[index] = {
      ...message,
      score: {
        content_score: turn.content_score,
        logic_score: turn.logic_score
      },
      meta: {
        competency: turn.competency,
        evidence: turn.evidence ?? [],
        missingAnchors: turn.missing_anchors ?? [],
        risks: turn.risks ?? [],
        source: "turn"
      }
    };
    break;
  }

  return nextMessages;
}

function buildMessagesFromSession(session: any): ChatMessage[] {
  const messages: ChatMessage[] = [];
  const firstQuestion = session.question_plan?.[0]?.question;
  if (firstQuestion) {
    messages.push({ role: "assistant", text: firstQuestion });
  }

  for (const turn of session.turns ?? []) {
    if (turn.answer_text) {
      messages.push({
        role: "user",
        text: turn.answer_text,
        score:
          typeof turn.content_score === "number" && typeof turn.logic_score === "number"
            ? {
                content_score: turn.content_score,
                logic_score: turn.logic_score
              }
            : undefined,
        meta: {
          competency: findCompetencyForQuestion(session, turn.question_id),
          evidence: Array.isArray(turn.evidence) ? turn.evidence : [],
          missingAnchors: Array.isArray(turn.missing_anchors) ? turn.missing_anchors : [],
          risks: Array.isArray(turn.risks) ? turn.risks : [],
          source: "turn"
        }
      });
    }
    if (turn.followup_question) {
      messages.push({ role: "assistant", text: turn.followup_question });
    }
  }

  if (session.report && !messages.some((item) => item.text === "本次模拟面试已完成，报告已生成。")) {
    messages.push({ role: "assistant", text: "本次模拟面试已完成，报告已生成。" });
  }

  return messages;
}

function buildTurnEvaluationsFromSession(session: any): TurnEvaluation[] {
  return (session.turns ?? [])
    .map((turn: any) => normalizeTurnEvaluation(turn, findCompetencyForQuestion(session, turn.question_id)))
    .filter(Boolean) as TurnEvaluation[];
}

function buildAnswerReviewCards(messages: ChatMessage[], jobRole: string): AnswerReviewCard[] {
  const pairs: Array<{ question: string; answer: string }> = [];
  let pendingQuestion = "";

  for (const message of messages) {
    if (message.role === "assistant") {
      if (/报告已生成|模拟面试报告|整体结果/.test(message.text)) continue;
      pendingQuestion = message.text;
      continue;
    }

    if (message.role === "user" && pendingQuestion) {
      pairs.push({ question: pendingQuestion, answer: message.text });
      pendingQuestion = "";
    }
  }

  return pairs.map((pair, index) => {
    const analysis = analyzeAnswerEvidence(pair.answer, jobRole);
    return {
      index: index + 1,
      question: pair.question,
      answer: pair.answer,
      summary: summarizeAnswer(pair.answer),
      missingEvidence: analysis.missingEvidence,
      betterAnswer: buildBetterAnswerExample(pair.question, pair.answer, jobRole, analysis),
      nextPractice: buildNextPractice(pair.question, analysis)
    };
  });
}

function normalizeReviewCardsPayload(cards: unknown): AnswerReviewCard[] {
  if (!Array.isArray(cards)) return [];

  return cards
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const value = item as Record<string, unknown>;
      const question = readPayloadString(value.question);
      const answer = readPayloadString(value.answer);
      if (!question || !answer) return null;

      return {
        index: readPayloadNumber(value.index) || index + 1,
        question,
        answer,
        summary: readPayloadString(value.summary) || summarizeAnswer(answer),
        missingEvidence: readPayloadStringArray(value.missingEvidence).slice(0, 4),
        betterAnswer: readPayloadString(value.betterAnswer) || "建议按背景、行动、结果、复盘重新组织回答。",
        nextPractice: readPayloadString(value.nextPractice) || "下一轮练习时先列出 2 个关键动作和 1 个量化结果。"
      };
    })
    .filter(Boolean) as AnswerReviewCard[];
}

function readPayloadString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readPayloadNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function readPayloadStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => readPayloadString(item)).filter(Boolean);
}

function buildLiveAssessmentMetrics(input: {
  report: Report | null;
  turnEvaluations: TurnEvaluation[];
  latestAnswerAnalysis: ReturnType<typeof analyzeAnswerEvidence> | null;
}): LiveAssessmentMetric[] {
  const reportMetrics = getReportMetrics(input.report);
  if (reportMetrics.length) {
    return reportMetrics;
  }

  const averages = summarizeTurnEvaluations(input.turnEvaluations);
  const analysis = input.latestAnswerAnalysis;
  const evidenceScore = estimateEvidenceScore(analysis);
  const professionalScore = clampScore(Math.round((averages.content + evidenceScore) / 2), input.turnEvaluations.length ? 60 : 0);
  const logicScore = clampScore(Math.round((averages.logic * 0.7) + estimateStructureScore(analysis) * 0.3), input.turnEvaluations.length ? 60 : 0);
  const expressionScore = clampScore(
    Math.round(
      (input.turnEvaluations.length ? averages.logic : 72) * 0.35 +
        (analysis ? estimateExpressionScore(analysis) : 76) * 0.4 +
        (analysis ? evidenceScore : 74) * 0.25
    ),
    input.turnEvaluations.length || analysis ? 58 : 0
  );
  const projectScore = clampScore(
    Math.round(
      (analysis ? estimateProjectScore(analysis) : 74) * 0.6 +
        (input.turnEvaluations.length ? averages.content : 72) * 0.4
    ),
    input.turnEvaluations.length || analysis ? 58 : 0
  );

  return [
    {
      name: "专业知识",
      score: professionalScore,
      detail: input.turnEvaluations.length
        ? `基于 ${input.turnEvaluations.length} 轮内容得分与证据完整度估算`
        : "开始回答后将根据内容质量更新"
    },
    {
      name: "逻辑思维",
      score: logicScore,
      detail: analysis?.hasContext && analysis?.hasAction && analysis?.hasResult ? "结构较完整，已覆盖背景-行动-结果" : "重点看回答是否有清晰结构和因果链"
    },
    {
      name: "表达能力",
      score: expressionScore,
      detail: analysis?.hasNumber ? "表达里已有数据支撑，可信度更高" : "补充数字、结果和结论，表达会更有说服力"
    },
    {
      name: "项目经验",
      score: projectScore,
      detail: analysis?.matchedKeywords.length
        ? `已贴近岗位关键词：${analysis.matchedKeywords.slice(0, 3).join("、")}`
        : "建议主动把经历贴回岗位关键词和业务场景"
    }
  ];
}

function buildSidebarSuggestions(input: {
  report: Report | null;
  latestAnswerAnalysis: ReturnType<typeof analyzeAnswerEvidence> | null;
  turnEvaluations: TurnEvaluation[];
  currentQuestion: Question | null;
  progressIndex: number;
  questionCount: number;
  roomPhase: RoomPhase;
}) {
  const reportSuggestions = getReportSuggestions(input.report);
  if (reportSuggestions.length) {
    return reportSuggestions.slice(0, 4);
  }

  const suggestions: string[] = [];
  const latestTurn = input.turnEvaluations.at(-1);

  if (input.roomPhase === "thinking") {
    suggestions.push("AI 正在分析这一轮回答，稍后会根据内容决定追问或进入下一题。");
  }

  if (input.currentQuestion?.competency) {
    suggestions.push(`当前重点考察：${input.currentQuestion.competency}，回答时尽量围绕这个能力展开。`);
  }

  if (input.latestAnswerAnalysis?.missingEvidence?.length) {
    suggestions.push(...input.latestAnswerAnalysis.missingEvidence.slice(0, 2));
  }

  if (latestTurn?.risks?.length) {
    suggestions.push(...latestTurn.risks.slice(0, 2));
  }

  if (latestTurn && latestTurn.content_score <= 2) {
    suggestions.push("这一轮内容分偏低，优先补清楚你的职责、动作和最终结果。");
  }

  if (latestTurn && latestTurn.logic_score <= 2) {
    suggestions.push("这一轮逻辑分偏低，建议按“背景-目标-行动-结果”顺序回答。");
  }

  if (input.progressIndex >= input.questionCount && !input.report) {
    suggestions.push("已接近本轮尾声，可以主动总结亮点并申请生成阶段报告。");
  }

  const unique = Array.from(new Set(suggestions.filter(Boolean)));
  if (unique.length) return unique.slice(0, 4);

  return [
    "结合具体项目经验回答，不要只讲概念。",
    "优先说清你的职责、关键动作和结果。",
    "尽量用数字、比例、周期或规模增强说服力。",
    "结尾补一句复盘，会比只讲过程更完整。"
  ];
}

function summarizeAnswer(answer: string) {
  const normalized = answer.replace(/\s+/g, " ").trim();
  if (!normalized) return "本题回答较少，需要补充完整经历。";
  if (normalized.length <= 52) return normalized;
  return `${normalized.slice(0, 52)}...`;
}

function analyzeAnswerEvidence(answer: string, jobRole: string) {
  const normalized = answer.toLowerCase();
  const hasNumber = /\d|%|百分|提升|降低|增长|减少|排名|top/i.test(answer);
  const hasAction = /负责|设计|搭建|分析|推进|协调|优化|完成|实现|解决|参与|主导|复盘/.test(answer);
  const hasResult = /结果|最终|因此|所以|产出|上线|落地|通过|获得|提升|降低|增长|转化|效率/.test(answer);
  const hasContext = /背景|目标|需求|问题|场景|项目|岗位|用户|客户|业务/.test(answer);
  const jobKeywords = getRoleKeywords(jobRole);
  const matchedKeywords = jobKeywords.filter((keyword) => normalized.includes(keyword.toLowerCase()));
  const missingEvidence: string[] = [];

  if (!hasContext) missingEvidence.push("缺少项目背景或业务场景，建议先说明当时要解决什么问题。");
  if (!hasAction) missingEvidence.push("缺少你的具体动作，建议说明你负责了哪些关键步骤。");
  if (!hasResult) missingEvidence.push("缺少结果闭环，建议补充产出、影响或复盘结论。");
  if (!hasNumber) missingEvidence.push("缺少量化证据，建议加入指标、规模、耗时或提升比例。");
  if (!matchedKeywords.length) missingEvidence.push(`和${jobRole}岗位的关键词关联还不明显，建议主动贴合岗位要求。`);

  if (!missingEvidence.length) {
    missingEvidence.push("回答结构较完整，下一步可补充更具体的难点、取舍和复盘。");
  }

  return {
    hasNumber,
    hasAction,
    hasResult,
    hasContext,
    matchedKeywords,
    missingEvidence: missingEvidence.slice(0, 4)
  };
}

function normalizeTurnEvaluation(turn: any, competency?: string): TurnEvaluation | null {
  if (!turn) return null;

  const contentScore = Number(turn.content_score);
  const logicScore = Number(turn.logic_score);
  if (!Number.isFinite(contentScore) || !Number.isFinite(logicScore)) return null;
  if (contentScore <= 0 && logicScore <= 0) return null;

  return {
    content_score: contentScore,
    logic_score: logicScore,
    evidence: Array.isArray(turn.evidence) ? turn.evidence : [],
    missing_anchors: Array.isArray(turn.missing_anchors) ? turn.missing_anchors : [],
    risks: Array.isArray(turn.risks) ? turn.risks : [],
    competency
  };
}

function mergeReportPayload(base: Report, raw: any): Report {
  return {
    ...base,
    competency_scores:
      raw && typeof raw.competency_scores === "object" && raw.competency_scores
        ? (raw.competency_scores as Record<string, number>)
        : base.competency_scores,
    strengths: Array.isArray(raw?.strengths) ? raw.strengths : base.strengths,
    risks: Array.isArray(raw?.risks) ? raw.risks : base.risks,
    improvements: Array.isArray(raw?.improvements) ? raw.improvements : base.improvements
  };
}

function findCompetencyForQuestion(session: any, questionId: string) {
  return session.question_plan?.find((item: any) => item.question_id === questionId)?.competency ?? "综合表现";
}

function summarizeTurnEvaluations(turns: TurnEvaluation[]) {
  if (!turns.length) {
    return { content: 72, logic: 72 };
  }

  const sums = turns.reduce(
    (acc, turn) => {
      acc.content += turn.content_score;
      acc.logic += turn.logic_score;
      return acc;
    },
    { content: 0, logic: 0 }
  );

  return {
    content: clampScore(Math.round((sums.content / turns.length / 4) * 100), 58),
    logic: clampScore(Math.round((sums.logic / turns.length / 4) * 100), 58)
  };
}

function estimateEvidenceScore(analysis: ReturnType<typeof analyzeAnswerEvidence> | null) {
  if (!analysis) return 74;
  let score = 92;
  if (!analysis.hasContext) score -= 12;
  if (!analysis.hasAction) score -= 12;
  if (!analysis.hasResult) score -= 14;
  if (!analysis.hasNumber) score -= 16;
  if (!analysis.matchedKeywords.length) score -= 8;
  return clampScore(score, 58);
}

function estimateStructureScore(analysis: ReturnType<typeof analyzeAnswerEvidence> | null) {
  if (!analysis) return 75;
  let score = 84;
  if (!analysis.hasContext) score -= 10;
  if (!analysis.hasAction) score -= 8;
  if (!analysis.hasResult) score -= 12;
  return clampScore(score, 58);
}

function estimateExpressionScore(analysis: ReturnType<typeof analyzeAnswerEvidence> | null) {
  if (!analysis) return 76;
  let score = 82;
  if (!analysis.hasNumber) score -= 10;
  if (!analysis.hasResult) score -= 8;
  if (!analysis.hasContext) score -= 6;
  return clampScore(score, 58);
}

function estimateProjectScore(analysis: ReturnType<typeof analyzeAnswerEvidence> | null) {
  if (!analysis) return 74;
  let score = 78;
  if (analysis.hasContext) score += 4;
  if (analysis.hasAction) score += 4;
  if (analysis.hasResult) score += 5;
  if (analysis.hasNumber) score += 5;
  if (!analysis.matchedKeywords.length) score -= 8;
  return clampScore(score, 58);
}

function clampScore(score: number, min = 0) {
  return Math.max(min, Math.min(100, score));
}

function buildBetterAnswerExample(
  question: string,
  answer: string,
  jobRole: string,
  analysis: ReturnType<typeof analyzeAnswerEvidence>
) {
  const roleHint = getRoleKeywords(jobRole).slice(0, 3).join("、") || "岗位核心能力";
  const originalPoint = summarizeAnswer(answer);
  const questionFocus = question.length > 34 ? `${question.slice(0, 34)}...` : question;

  return [
    `可以按“背景-行动-结果-复盘”重答：针对“${questionFocus}”，先说明项目背景和目标；`,
    `再讲清楚你本人做了什么，尤其突出${roleHint}相关动作；`,
    analysis.hasNumber ? "最后用已有数据说明结果，并补充一个复盘点。" : "最后补一个可量化结果，例如效率、转化、准确率、用户反馈或完成周期。",
    `你原回答的核心可以保留为：“${originalPoint}”。`
  ].join("");
}

function buildNextPractice(question: string, analysis: ReturnType<typeof analyzeAnswerEvidence>) {
  if (!analysis.hasContext) return "下一次先用 15 秒交代背景、目标和约束，再进入具体动作。";
  if (!analysis.hasAction) return "下一次重点练习“我做了什么”，至少列出 2 个具体动作。";
  if (!analysis.hasResult) return "下一次回答结尾必须补充结果和复盘，避免只讲过程。";
  if (!analysis.hasNumber) return "下一次准备 2 个数字证据，例如项目规模、完成周期、转化率或效率变化。";
  return "下一次练习可以增加难点、取舍和反思，让回答从“做过”升级到“做得有判断”。";
}

function getRoleKeywords(jobRole: string) {
  const role = jobRole.toLowerCase();
  if (/数据|分析/.test(role)) return ["SQL", "Excel", "Python", "指标", "报表", "可视化", "业务分析"];
  if (/产品|pm|经理/.test(role)) return ["需求", "用户", "原型", "PRD", "流程", "指标", "迭代"];
  if (/java|后端|开发/.test(role)) return ["Java", "Spring", "接口", "数据库", "MySQL", "Redis", "性能"];
  if (/运营|新媒体/.test(role)) return ["内容", "活动", "用户", "增长", "转化", "复盘", "数据"];
  if (/销售|顾问/.test(role)) return ["客户", "需求", "沟通", "方案", "转化", "跟进", "成交"];
  return ["项目", "沟通", "协作", "结果", "复盘"];
}

function withDeviceNotes(
  markdown: string,
  input: { mode: "text" | "voice" | "video"; audio: AudioMetrics; video: VideoMetrics }
) {
  if (/多模态表现分析/.test(markdown)) return markdown;

  const notes = [
    "",
    "## 多模态表现分析",
    "",
    `- 面试模式：${input.mode === "video" ? "实时语音视频仿真面试" : input.mode === "voice" ? "语音输入面试" : "文字面试"}`,
    `- 语音表达：${describeAudioMetrics(input.audio)}`,
    `- 视频呈现：${describeVideoMetrics(input.video, input.mode)}`,
    "- 改进建议：回答前先用 2-3 秒组织结构，保持语速稳定；视频面试时保证正面光源和镜头稳定。",
    "- 说明：本项仅分析线上面试的表达流畅度与呈现环境，不评价外貌、人格或情绪。"
  ].join("\n");

  return `${markdown.trim()}\n${notes}\n`;
}

function createAudioMetricDraft(startedAt = 0): AudioMetricDraft {
  return {
    sampleCount: 0,
    volumeTotal: 0,
    silentFrames: 0,
    pauseCount: 0,
    inPause: false,
    pauseStartedAt: 0,
    recordingStartedAt: startedAt
  };
}

function updateAudioMetricDraft(draft: AudioMetricDraft, volume: number, now: number) {
  draft.sampleCount += 1;
  draft.volumeTotal += volume;

  if (volume <= 0.018) {
    draft.silentFrames += 1;
    if (!draft.inPause) {
      draft.inPause = true;
      draft.pauseStartedAt = now;
    } else if (now - draft.pauseStartedAt > 800) {
      draft.pauseCount += 1;
      draft.pauseStartedAt = now + 100000;
    }
    return;
  }

  draft.inPause = false;
  draft.pauseStartedAt = 0;
}

function finalizeAudioMetrics(draft: AudioMetricDraft, transcript: string, source: AudioMetrics["source"]): AudioMetrics {
  const durationSeconds = Math.max(
    1,
    draft.recordingStartedAt ? Math.round((Date.now() - draft.recordingStartedAt) / 1000) : estimateAnswerDuration(transcript)
  );
  const transcriptLength = countChineseLikeChars(transcript);
  const averageVolume = draft.sampleCount ? Number((draft.volumeTotal / draft.sampleCount).toFixed(4)) : 0;
  const silenceRatio = draft.sampleCount ? Number((draft.silentFrames / draft.sampleCount).toFixed(2)) : 0;
  const speechRate = Math.round((transcriptLength / durationSeconds) * 60);
  const fillerCount = countFillers(transcript);
  const fluencyScore = scoreFluency({ speechRate, pauseCount: draft.pauseCount, silenceRatio, fillerCount, transcriptLength });

  return {
    duration_seconds: durationSeconds,
    speech_rate_cpm: speechRate,
    pause_count: draft.pauseCount,
    silence_ratio: silenceRatio,
    average_volume: averageVolume,
    fluency_score: fluencyScore,
    filler_count: fillerCount,
    transcript_length: transcriptLength,
    source
  };
}

function estimateTextAudioMetrics(text: string, source: AudioMetrics["source"]): AudioMetrics {
  const draft = createAudioMetricDraft(Date.now() - estimateAnswerDuration(text) * 1000);
  return finalizeAudioMetrics(draft, text, source);
}

function estimateAnswerDuration(text: string) {
  return Math.max(8, Math.round((countChineseLikeChars(text) / 180) * 60));
}

function countChineseLikeChars(text: string) {
  return text.replace(/\s|[,.，。!?！？;；:：'"“”‘’()[\]{}<>《》、\-_*#`]/g, "").length;
}

function countFillers(text: string) {
  const matches = text.match(/嗯|呃|额|然后|就是|那个|这个|其实|就是说/g);
  return matches?.length ?? 0;
}

function scoreFluency(input: {
  speechRate: number;
  pauseCount: number;
  silenceRatio: number;
  fillerCount: number;
  transcriptLength: number;
}) {
  let score = 88;
  if (input.speechRate < 90) score -= 10;
  if (input.speechRate > 260) score -= 8;
  score -= Math.min(18, input.pauseCount * 4);
  score -= Math.min(12, Math.round(input.silenceRatio * 20));
  score -= Math.min(10, input.fillerCount * 2);
  if (input.transcriptLength < 40) score -= 8;
  return Math.max(45, Math.min(100, score));
}

function createVideoMetricDraft(): VideoMetricDraft {
  return {
    sampleCount: 0,
    brightnessTotal: 0,
    frameChangeTotal: 0,
    frameChangeCount: 0
  };
}

function updateVideoMetricDraft(
  draft: VideoMetricDraft,
  data: Uint8ClampedArray,
  brightness: number,
  cameraEnabled: boolean
): VideoMetrics {
  draft.sampleCount += 1;
  draft.brightnessTotal += brightness;

  if (draft.previousFrame) {
    let diffTotal = 0;
    for (let index = 0; index < data.length; index += 16) {
      diffTotal += Math.abs(data[index] - draft.previousFrame[index]);
    }
    const frameChange = diffTotal / (data.length / 16);
    draft.frameChangeTotal += frameChange;
    if (frameChange > 32) draft.frameChangeCount += 1;
  }

  draft.previousFrame = new Uint8ClampedArray(data);
  const averageFrameChange = draft.sampleCount > 1 ? draft.frameChangeTotal / (draft.sampleCount - 1) : 0;
  const stabilityScore = draft.sampleCount > 1 ? Math.max(45, Math.min(100, Math.round(100 - averageFrameChange * 1.3))) : null;

  return {
    camera_enabled: cameraEnabled,
    brightness,
    brightness_status: brightnessStatus(brightness),
    stability_score: stabilityScore,
    frame_change_count: draft.frameChangeCount,
    sample_count: draft.sampleCount
  };
}

function brightnessStatus(brightness: number | null): VideoMetrics["brightness_status"] {
  if (brightness === null) return "not_collected";
  if (brightness < 35) return "dark";
  if (brightness > 86) return "bright";
  return "normal";
}

function formatAudioMetrics(metrics: AudioMetrics) {
  return `语音表现：${metrics.duration_seconds} 秒，语速 ${metrics.speech_rate_cpm} 字/分钟，明显停顿 ${metrics.pause_count} 次，流畅度 ${metrics.fluency_score}/100。`;
}

function describeAudioMetrics(metrics: AudioMetrics) {
  const rateText =
    metrics.speech_rate_cpm < 90 ? "语速偏慢" : metrics.speech_rate_cpm > 260 ? "语速偏快" : "语速较稳定";
  const pauseText = metrics.pause_count >= 3 ? `出现 ${metrics.pause_count} 次明显停顿` : "停顿控制较好";
  const fillerText = metrics.filler_count >= 4 ? `口头填充词较多（${metrics.filler_count} 次）` : "口头填充词不多";
  return `${rateText}，${pauseText}，${fillerText}，综合流畅度 ${metrics.fluency_score}/100。`;
}

function describeVideoMetrics(metrics: VideoMetrics, mode: "text" | "voice" | "video") {
  if (mode !== "video") return "本轮未启用视频面试，仅进行语音/文字表达分析。";
  if (!metrics.camera_enabled) return "摄像头未开启或已关闭，未采集视频呈现指标。";

  const brightnessText =
    metrics.brightness === null
      ? "光线未采集"
      : metrics.brightness_status === "dark"
        ? `光线偏暗（${metrics.brightness}%）`
        : metrics.brightness_status === "bright"
          ? `光线偏亮（${metrics.brightness}%）`
          : `光线正常（${metrics.brightness}%）`;
  const stabilityText =
    metrics.stability_score === null ? "画面稳定性样本不足" : `画面稳定性 ${metrics.stability_score}/100`;
  return `${brightnessText}，${stabilityText}，原始视频不上传，仅在本地采样环境指标。`;
}

function makeVideoMetricsSnapshot(input: {
  cameraEnabled: boolean;
  brightness: number | null;
  draft: VideoMetricDraft;
}): VideoMetrics {
  const averageBrightness = input.draft.sampleCount
    ? Math.round(input.draft.brightnessTotal / input.draft.sampleCount)
    : input.brightness;
  const averageFrameChange =
    input.draft.sampleCount > 1 ? input.draft.frameChangeTotal / (input.draft.sampleCount - 1) : null;

  return {
    camera_enabled: input.cameraEnabled,
    brightness: averageBrightness,
    brightness_status: brightnessStatus(averageBrightness),
    stability_score:
      averageFrameChange === null ? null : Math.max(45, Math.min(100, Math.round(100 - averageFrameChange * 1.3))),
    frame_change_count: input.draft.frameChangeCount,
    sample_count: input.draft.sampleCount
  };
}

function roomPhaseLabel(phase: RoomPhase): string {
  const labels: Record<RoomPhase, string> = {
    idle: "等待候选人回答",
    ai_speaking: "正在提问",
    listening: "正在聆听",
    transcribing: "正在识别语音",
    thinking: "正在提交给 Dify",
    completed: "报告已生成"
  };

  return labels[phase];
}

function cleanSpeechText(text: string): string {
  return text
    .replace(/[#*_>`~|]/g, "")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/\[[^\]]+\]\([^)]+\)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function estimateSpeechDurationMs(text: string): number {
  const cleaned = cleanSpeechText(text);
  const chineseChars = (cleaned.match(/[\u4e00-\u9fa5]/g) ?? []).length;
  const otherWords = cleaned.replace(/[\u4e00-\u9fa5]/g, " ").trim().split(/\s+/).filter(Boolean).length;
  const estimatedSeconds = chineseChars / 4.2 + otherWords / 2.4;
  return Math.min(90000, Math.max(3500, Math.round(estimatedSeconds * 1000)));
}

function compactRepeatedSpeech(text: string): string {
  let normalized = text.replace(/\s+/g, "").trim();
  if (!normalized) return "";

  normalized = mergeRepeatedPrefixes(normalized);
  normalized = mergeIncrementalSpeechChunks(normalized);
  normalized = mergeOverlappingChunks(normalized);
  normalized = removeConsecutivePhraseRepeats(normalized);

  return normalized;
}

function mergeRepeatedPrefixes(text: string): string {
  let result = text;
  let changed = true;

  while (changed) {
    changed = false;

    for (let length = Math.floor(result.length / 2); length >= 4; length -= 1) {
      const prefix = result.slice(0, length);
      const nextIndex = result.indexOf(prefix, 1);

      if (nextIndex > 0 && nextIndex <= length + 6) {
        result = result.slice(nextIndex);
        changed = true;
        break;
      }
    }
  }

  return result;
}

function mergeOverlappingChunks(text: string): string {
  const chunks = text
    .split(/(?<=[。！？!?；;，,])/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (chunks.length <= 1) return text;

  return chunks.reduce((merged, chunk) => {
    if (!merged) return chunk;
    if (merged.endsWith(chunk)) return merged;

    const maxOverlap = Math.min(merged.length, chunk.length);
    for (let length = maxOverlap; length >= 4; length -= 1) {
      if (merged.endsWith(chunk.slice(0, length))) {
        return `${merged}${chunk.slice(length)}`;
      }
    }

    return `${merged}${chunk}`;
  }, "");
}

function mergeIncrementalSpeechChunks(text: string): string {
  const chunks = splitSpeechIntoChunks(text);
  if (chunks.length <= 1) return text;

  const merged: string[] = [];
  for (const chunk of chunks) {
    const previous = merged.at(-1);
    if (!previous) {
      merged.push(chunk);
      continue;
    }

    if (chunk === previous || previous.endsWith(chunk)) continue;
    if (chunk.endsWith(previous) || chunk.includes(previous)) {
      merged[merged.length - 1] = chunk;
      continue;
    }

    const overlap = findTextOverlap(previous, chunk, 4);
    if (overlap > 0) {
      merged[merged.length - 1] = `${previous}${chunk.slice(overlap)}`;
      continue;
    }

    merged.push(chunk);
  }

  return merged.join("");
}

function splitSpeechIntoChunks(text: string): string[] {
  const chunks: string[] = [];
  let buffer = "";

  for (const char of text) {
    buffer += char;
    if (/[，。！？；,.!?;]/.test(char) || buffer.length >= 18) {
      chunks.push(buffer);
      buffer = "";
    }
  }

  if (buffer) chunks.push(buffer);
  return chunks.filter(Boolean);
}

function findTextOverlap(left: string, right: string, minLength: number) {
  const maxLength = Math.min(left.length, right.length);
  for (let length = maxLength; length >= minLength; length -= 1) {
    if (left.endsWith(right.slice(0, length))) return length;
  }
  return 0;
}

function removeConsecutivePhraseRepeats(text: string): string {
  let result = text;
  let changed = true;

  while (changed) {
    changed = false;
    for (let length = Math.min(32, Math.floor(result.length / 2)); length >= 3; length -= 1) {
      const pattern = new RegExp(`(.{${length}})\\1+`, "g");
      const next = result.replace(pattern, "$1");
      if (next !== result) {
        result = next;
        changed = true;
      }
    }
  }

  return result;
}

function encodeWav(chunks: Float32Array[], inputSampleRate: number, outputSampleRate: number): Blob {
  const samples = trimEdgeSilence(mergeAudioChunks(chunks), inputSampleRate);
  const resampled = downsample(samples, inputSampleRate, outputSampleRate);
  const buffer = new ArrayBuffer(44 + resampled.length * 2);
  const view = new DataView(buffer);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + resampled.length * 2, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, outputSampleRate, true);
  view.setUint32(28, outputSampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, resampled.length * 2, true);

  let offset = 44;
  for (const sample of resampled) {
    const clipped = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

function trimEdgeSilence(samples: Float32Array, sampleRate: number): Float32Array {
  if (!samples.length) return samples;

  const frameSize = Math.max(256, Math.floor(sampleRate * 0.04));
  const threshold = 0.012;
  let start = 0;
  let end = samples.length;

  for (let index = 0; index < samples.length; index += frameSize) {
    if (rms(samples.subarray(index, Math.min(samples.length, index + frameSize))) > threshold) {
      start = Math.max(0, index - frameSize * 2);
      break;
    }
  }

  for (let index = samples.length; index > 0; index -= frameSize) {
    const frameStart = Math.max(0, index - frameSize);
    if (rms(samples.subarray(frameStart, index)) > threshold) {
      end = Math.min(samples.length, index + frameSize * 2);
      break;
    }
  }

  if (end <= start) return samples;
  return samples.subarray(start, end);
}

function mergeAudioChunks(chunks: Float32Array[]): Float32Array {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Float32Array(length);
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  return merged;
}

function downsample(samples: Float32Array, inputRate: number, outputRate: number): Float32Array {
  if (outputRate === inputRate) return samples;
  const ratio = inputRate / outputRate;
  const newLength = Math.round(samples.length / ratio);
  const result = new Float32Array(newLength);

  for (let index = 0; index < newLength; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.min(Math.floor((index + 1) * ratio), samples.length);
    let total = 0;
    for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
      total += samples[sampleIndex];
    }
    result[index] = total / Math.max(1, end - start);
  }

  return result;
}

function writeString(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function rms(samples: Float32Array): number {
  let total = 0;
  for (const sample of samples) {
    total += sample * sample;
  }
  return Math.sqrt(total / Math.max(1, samples.length));
}

function browserSpeechErrorMessage(error: string): string {
  const messages: Record<string, string> = {
    "not-allowed": "麦克风权限被拒绝，请在浏览器地址栏允许麦克风权限。",
    "no-speech": "没有检测到语音，可以靠近麦克风后再试一次。",
    "audio-capture": "没有检测到可用麦克风。",
    network: "浏览器语音识别网络连接失败，可以改用文字输入或稍后重试。"
  };

  return messages[error] ?? `浏览器语音识别失败：${error}`;
}

function cameraErrorMessage(error: string): string {
  const messages: Record<string, string> = {
    NotAllowedError: "摄像头权限被拒绝，请在浏览器地址栏允许摄像头权限。",
    NotFoundError: "没有检测到可用摄像头。",
    NotReadableError: "摄像头正在被其他程序占用。",
    OverconstrainedError: "当前摄像头不支持请求的视频参数。"
  };

  return messages[error] ?? `摄像头开启失败：${error}`;
}

async function parseJsonResponse(response: Response) {
  const text = await response.text();
  if (!text) return {} as Record<string, any>;

  try {
    return JSON.parse(text);
  } catch {
    return { error: text.slice(0, 500) || "服务器返回了非 JSON 内容" };
  }
}

async function transcribeAnswerAudio(wav: Blob, endpoint: "/api/asr/xfyun" | "/api/asr/spark") {
  const formData = new FormData();
  formData.append("audio_file", wav, "answer.wav");
  const response = await fetch(endpoint, { method: "POST", body: formData });
  const payload = await parseJsonResponse(response);

  if (!response.ok) {
    throw new Error(payload.error ?? "语音识别失败");
  }

  return compactRepeatedSpeech(String(payload.transcript ?? ""));
}

function isSuspiciouslyShortTranscript(transcript: string, recordingSeconds: number) {
  const length = countChineseLikeChars(transcript);
  if (recordingSeconds >= 35 && length < 45) return true;
  if (recordingSeconds >= 20 && length < 25) return true;
  return false;
}

function readErrorMessage(error: unknown, fallback: string) {
  if (!error) return fallback;
  if (typeof error === "string") return error;

  if (typeof error === "object") {
    const fieldErrors = (error as { fieldErrors?: Record<string, string[]> }).fieldErrors;
    if (fieldErrors) {
      const messages = Object.values(fieldErrors).flat().filter(Boolean);
      if (messages.length) return messages.join("\n");
    }
  }

  return fallback;
}

function extractDimensionScores(markdown: string) {
  const regex = /[-*]\s*(?:\*\*)?([^：:\n*]+)(?:\*\*)?\s*[:：]\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+)/g;
  const allowed = new Set(["自我介绍", "岗位匹配", "专业能力", "项目证据", "逻辑表达", "复盘成长"]);
  const items: Array<{ name: string; score: number; max: number }> = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(markdown)) !== null) {
    const name = match[1].replace(/\*/g, "").trim();
    if (allowed.has(name)) {
      items.push({ name, score: Number(match[2]), max: Number(match[3]) });
    }
  }

  return items;
}

function getReportMetrics(report: Report | null): LiveAssessmentMetric[] {
  if (!report) return [];

  const structuredMetrics = Object.entries(report.competency_scores ?? {})
    .map(([name, score]) => ({
      name,
      score: clampScore(Math.round(Number(score))),
      detail: "来自最终报告的结构化维度评分"
    }))
    .filter((item) => Number.isFinite(item.score));

  if (structuredMetrics.length) {
    return structuredMetrics;
  }

  return extractDimensionScores(report.report_markdown).map((item) => ({
    name: item.name,
    score: clampScore(Math.round((item.score / item.max) * 100)),
    detail: `${item.score} / ${item.max}，来自最终报告`
  }));
}

function getReportSuggestions(report: Report | null) {
  if (!report) return [];

  const direct = [
    ...(report.improvements ?? []),
    ...(report.risks ?? []),
    ...(report.strengths?.slice(0, 1).map((item) => `保留优势：${item}`) ?? [])
  ]
    .map((item) => item.trim())
    .filter(Boolean);

  if (direct.length) {
    return direct;
  }

  return extractReportListItems(report.report_markdown, ["改进建议", "待验证项", "优势"]);
}

function extractReportListItems(markdown: string, headings: string[]) {
  const suggestions: string[] = [];

  for (const heading of headings) {
    const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const sectionRegex = new RegExp(`##\\s*${escapedHeading}[\\s\\S]*?(?=\\n##\\s|$)`);
    const section = markdown.match(sectionRegex)?.[0];
    if (!section) continue;

    const items = section
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^[-*]\s+|^\d+\.\s+/.test(line))
      .map((line) => line.replace(/^[-*]\s+|^\d+\.\s+/, "").trim())
      .filter(Boolean);

    suggestions.push(...items);
  }

  return Array.from(new Set(suggestions)).slice(0, 4);
}
