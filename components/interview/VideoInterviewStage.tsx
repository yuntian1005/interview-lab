"use client";

import { RefObject } from "react";
import { AvatarState } from "@/lib/interviewAvatar";
import { InterviewerAvatar } from "@/components/interview/InterviewerAvatar";
import { InterviewStatus } from "@/components/interview/InterviewStatus";

type VideoInterviewStageProps = {
  localVideoRef: RefObject<HTMLVideoElement | null>;
  isCameraOn: boolean;
  avatarState: AvatarState;
  avatarName?: string;
  statusText: string;
  progressText: string;
  cameraError?: string | null;
  onToggleCamera?: () => void;
  videoMetrics?: {
    brightness?: number | null;
    stabilityScore?: number | null;
  };
};

export function VideoInterviewStage({
  localVideoRef,
  isCameraOn,
  avatarState,
  avatarName = "AI 面试官",
  statusText,
  progressText,
  cameraError,
  onToggleCamera,
  videoMetrics
}: VideoInterviewStageProps) {
  return (
    <div className="video-interview-stage">
      <div className="video-stage-grid">
        <section className="video-stage-card candidate-stage-card" aria-label="候选人本地摄像头预览">
          <div className="video-stage-card-header">
            <strong>候选人</strong>
            <span>本地预览，不上传原始视频</span>
          </div>
          <div className="candidate-stage-video">
            {isCameraOn ? null : (
              <div className="candidate-stage-placeholder">
                <strong>摄像头未开启</strong>
                <span>{cameraError || "可以开启摄像头获得更接近线上面试的体验。"}</span>
                {onToggleCamera ? (
                  <button className="secondary" type="button" onClick={onToggleCamera}>
                    开启摄像头
                  </button>
                ) : null}
              </div>
            )}
            <video ref={localVideoRef} autoPlay playsInline muted />
          </div>
          <div className="video-stage-meta">
            <span>{isCameraOn ? "摄像头已开启" : "摄像头未开启"}</span>
            {typeof videoMetrics?.brightness === "number" ? <span>亮度 {videoMetrics.brightness}%</span> : null}
            {typeof videoMetrics?.stabilityScore === "number" ? <span>稳定性 {videoMetrics.stabilityScore}/100</span> : null}
          </div>
        </section>

        <section className="video-stage-card interviewer-stage-card" aria-label="AI 面试官">
          <InterviewerAvatar state={avatarState} displayName={avatarName} />
        </section>
      </div>

      <InterviewStatus state={avatarState} progressText={progressText} detail={statusText} />
    </div>
  );
}
