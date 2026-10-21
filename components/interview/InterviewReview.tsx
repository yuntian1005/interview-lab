"use client";

type ReviewMessage = {
  role: "assistant" | "user";
  text: string;
};

type InterviewReviewProps = {
  messages: ReviewMessage[];
  questionCount: number;
  reportReady: boolean;
  onShowReport: () => void;
  onBackToInterview?: () => void;
};

type ReviewPair = {
  question: string;
  answer?: string;
  label: string;
};

export function InterviewReview({
  messages,
  questionCount,
  reportReady,
  onShowReport,
  onBackToInterview
}: InterviewReviewProps) {
  const pairs = buildReviewPairs(messages);

  return (
    <div className="interview-review">
      <div className="review-header">
        <div>
          <span>面试已完成</span>
          <h3>面试回顾</h3>
          <p>本次共完成 {Math.max(pairs.length, questionCount)} 轮问答。报告已生成后，可继续查看详细评分与建议。</p>
        </div>
        <div className="action-group">
          {onBackToInterview ? (
            <button className="secondary" type="button" onClick={onBackToInterview}>
              返回面试
            </button>
          ) : null}
          <button className="primary compact" type="button" onClick={onShowReport} disabled={!reportReady}>
            {reportReady ? "查看面试报告" : "正在整理报告"}
          </button>
        </div>
      </div>

      <div className="review-list">
        {pairs.length ? (
          pairs.map((pair, index) => (
            <article className="review-item" key={`${pair.label}-${index}`}>
              <div className="review-index">{pair.label}</div>
              <div className="review-content">
                <section>
                  <strong>面试官</strong>
                  <p>{pair.question}</p>
                </section>
                <section>
                  <strong>你的回答</strong>
                  <p>{pair.answer || "本轮没有记录到回答。"}</p>
                </section>
              </div>
            </article>
          ))
        ) : (
          <div className="upload-state">暂无可展示的问答记录。</div>
        )}
      </div>
    </div>
  );
}

function buildReviewPairs(messages: ReviewMessage[]): ReviewPair[] {
  const pairs: ReviewPair[] = [];
  let pendingQuestion = "";
  let questionIndex = 1;

  for (const message of messages) {
    if (message.role === "assistant") {
      if (/报告已生成|模拟面试报告|整体结果/.test(message.text)) continue;
      if (pendingQuestion) {
        pairs.push({ question: pendingQuestion, label: `第 ${questionIndex} 轮` });
        questionIndex += 1;
      }
      pendingQuestion = message.text;
      continue;
    }

    if (message.role === "user") {
      if (pendingQuestion) {
        pairs.push({ question: pendingQuestion, answer: message.text, label: `第 ${questionIndex} 轮` });
        pendingQuestion = "";
        questionIndex += 1;
      } else {
        pairs.push({ question: "候选人主动补充", answer: message.text, label: `第 ${questionIndex} 轮` });
        questionIndex += 1;
      }
    }
  }

  if (pendingQuestion) {
    pairs.push({ question: pendingQuestion, label: `第 ${questionIndex} 轮` });
  }

  return pairs;
}
