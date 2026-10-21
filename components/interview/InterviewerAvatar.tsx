"use client";

import { AvatarState, avatarStatusText } from "@/lib/interviewAvatar";

type InterviewerAvatarProps = {
  state: AvatarState;
  displayName?: string;
  muted?: boolean;
  className?: string;
};

export function InterviewerAvatar({
  state,
  displayName = "AI 面试官",
  muted = false,
  className = ""
}: InterviewerAvatarProps) {
  return (
    <div className={`interviewer-avatar interviewer-avatar-${state} ${className}`} aria-label={`${displayName}：${avatarStatusText[state]}`}>
      <div className="interviewer-avatar-stage" aria-hidden="true">
        <div className="interviewer-avatar-halo" />
        <div className="interviewer-avatar-person">
          <div className="interviewer-avatar-head">
            <span className="interviewer-avatar-hair" />
            <span className="interviewer-avatar-ear left" />
            <span className="interviewer-avatar-ear right" />
            <span className="interviewer-avatar-eye left" />
            <span className="interviewer-avatar-eye right" />
            <span className="interviewer-avatar-brow left" />
            <span className="interviewer-avatar-brow right" />
            <span className="interviewer-avatar-mouth" />
          </div>
          <div className="interviewer-avatar-neck" />
          <div className="interviewer-avatar-body">
            <span className="interviewer-avatar-shirt" />
            <span className="interviewer-avatar-tie" />
          </div>
        </div>
        <div className="interviewer-avatar-signal">
          <i />
          <i />
          <i />
        </div>
        <div className="interviewer-avatar-thinking">
          <i />
          <i />
          <i />
        </div>
      </div>
      <div className="interviewer-avatar-caption">
        <strong>{displayName}</strong>
        <span>{muted ? "语音已静音" : avatarStatusText[state]}</span>
      </div>
    </div>
  );
}
