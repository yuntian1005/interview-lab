"use client";

import { AvatarState, avatarStatusText } from "@/lib/interviewAvatar";

type InterviewStatusProps = {
  state: AvatarState;
  progressText: string;
  detail?: string;
};

export function InterviewStatus({ state, progressText, detail }: InterviewStatusProps) {
  return (
    <div className={`interview-status interview-status-${state}`} role="status" aria-live="polite">
      <span className="interview-status-dot" aria-hidden="true" />
      <div>
        <strong>{avatarStatusText[state]}</strong>
        <span>{detail || progressText}</span>
      </div>
      <em>{progressText}</em>
    </div>
  );
}
