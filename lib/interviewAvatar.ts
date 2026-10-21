export type AvatarState = "idle" | "listening" | "thinking" | "speaking" | "error";

export type InterviewDisplayPhase = "config" | "interviewing" | "review" | "report";

export const avatarStatusText: Record<AvatarState, string> = {
  idle: "等待你的回答",
  listening: "正在倾听你的回答",
  thinking: "正在分析并准备下一题",
  speaking: "AI 面试官正在提问",
  error: "语音服务暂不可用，可切换文字输入"
};
