import {
  EvaluateTurnResult,
  GenerateReportResult,
  PrepareInterviewResult,
  Question,
  Turn
} from "@/lib/types";

const baseAnchors = ["背景", "本人职责", "方法", "关键数据", "结果指标", "复盘"];

export function mockPrepareInterview(input: {
  resume_text: string;
  jd_text: string;
  job_level: string;
  interview_mode: string;
  question_count?: number;
}): PrepareInterviewResult {
  const role = inferRole(input.jd_text);
  const questions: Question[] = [
    {
      question_id: "Q01",
      question_type: "resume_deep_dive",
      question: `请先介绍一个你最能证明自己适合${role}岗位的经历。`,
      competency: "岗位匹配与项目证据",
      weight: 18,
      expected_anchors: baseAnchors,
      followup_targets: ["本人职责", "可量化结果", "项目真实性"],
      max_followups: 2
    },
    {
      question_id: "Q02",
      question_type: "professional",
      question: `结合 JD 要求，讲一个你解决专业问题或使用核心工具完成任务的案例。`,
      competency: "专业能力",
      weight: 18,
      expected_anchors: ["问题定义", "工具或方法", "执行过程", "验证方式", "结果"],
      followup_targets: ["方法细节", "验证口径", "方案取舍"],
      max_followups: 2
    },
    {
      question_id: "Q03",
      question_type: "behavioral",
      question: "请讲一次你和他人协作推进复杂任务的经历。",
      competency: "协作沟通",
      weight: 15,
      expected_anchors: ["协作对象", "分歧或困难", "沟通动作", "推进结果", "复盘"],
      followup_targets: ["个人贡献", "冲突处理", "结果"],
      max_followups: 2
    },
    {
      question_id: "Q04",
      question_type: "scenario",
      question: `如果入职后发现${role}相关任务目标很模糊，你会如何拆解并推进？`,
      competency: "问题拆解与业务理解",
      weight: 16,
      expected_anchors: ["目标澄清", "信息收集", "优先级", "执行计划", "风险控制"],
      followup_targets: ["优先级依据", "落地动作", "风险预案"],
      max_followups: 2
    },
    {
      question_id: "Q05",
      question_type: "motivation",
      question: `你为什么想申请${role}方向？你和这个岗位最匹配的三点是什么？`,
      competency: "求职动机与岗位认知",
      weight: 13,
      expected_anchors: ["岗位理解", "个人优势", "职业目标", "匹配证据"],
      followup_targets: ["岗位理解", "证据", "长期目标"],
      max_followups: 2
    },
    {
      question_id: "Q06",
      question_type: "reflection",
      question: "回顾你过去的项目或实习经历，有哪一次做得不够好？你后来如何改进？",
      competency: "复盘与成长",
      weight: 20,
      expected_anchors: ["具体场景", "问题原因", "个人责任", "改进行动", "后续结果"],
      followup_targets: ["个人责任", "具体改进", "后续验证"],
      max_followups: 2
    }
  ];

  // Eight deterministic prompts cover all question counts offered by the UI.
  questions.push(
    { ...questions[1], question_id: "Q07", question: "如果交付时间突然缩短，你会如何确定优先级并保证关键质量？", competency: "优先级与交付" },
    { ...questions[2], question_id: "Q08", question: "请说明你如何学习一项陌生技能，并用实际结果验证学习效果。", competency: "学习与验证" },
  );
  const selected = questions.slice(0, input.question_count ?? 5);
  return {
    candidate_profile: {
      summary: input.resume_text.slice(0, 220),
      target_role: role
    },
    jd_profile: {
      role_name: role,
      seniority: input.job_level,
      responsibilities: [input.jd_text.slice(0, 220)],
      core_competencies: ["岗位匹配", "专业能力", "沟通表达", "复盘成长"]
    },
    match_matrix: [
      {
        competency: "岗位匹配",
        jd_requirement: input.jd_text.slice(0, 120),
        resume_evidence: input.resume_text.slice(0, 120),
        match_level: "unknown",
        risk: "Mock 模式未进行真实语义评分，需接入 Coze 工作流校准。"
      }
    ],
    question_plan: selected,
    first_question: selected[0].question
  };
}

export function mockEvaluateTurn(input: {
  answer_text: string;
  expected_anchors: string[];
  followup_count: number;
  max_followups: number;
}): EvaluateTurnResult {
  const text = input.answer_text.trim();
  const covered = input.expected_anchors.filter((anchor) => text.includes(anchor) || text.length > 80);
  const missing = input.expected_anchors.filter((anchor) => !covered.includes(anchor));
  const hasNumbers = /\d|%|百分比|提升|降低|增长|减少/.test(text);
  const hasRole = /我|本人|负责|主导|参与|独立/.test(text);
  const score = Math.max(1, Math.min(4, Math.round(text.length / 90) + (hasNumbers ? 1 : 0)));
  const shouldFollow = input.followup_count < input.max_followups && (!hasRole || !hasNumbers || missing.length > 2);
  const followup = !hasRole
    ? "这个项目中你个人具体负责哪些部分？"
    : !hasNumbers
      ? "这个经历最终带来了哪些可量化结果，指标口径是什么？"
      : `你能进一步说明${missing[0] || "方案取舍"}吗？`;

  return {
    content_score: score,
    logic_score: Math.max(1, Math.min(4, score - (text.length < 40 ? 1 : 0))),
    evidence: text ? [`候选人回答提到：${text.slice(0, 80)}${text.length > 80 ? "..." : ""}`] : [],
    covered_anchors: covered,
    missing_anchors: missing,
    risks: missing.length ? [`仍缺少：${missing.slice(0, 3).join("、")}`] : [],
    need_followup: shouldFollow,
    followup_question: shouldFollow ? followup : "",
    candidate_feedback_preview: shouldFollow ? "回答已有基础信息，但还需要补充关键证据。" : "回答信息较完整，可以进入下一题。",
    next_action: shouldFollow ? "ask_followup" : "next_question"
  };
}

export function mockGenerateReport(input: { turns: Turn[] }): GenerateReportResult {
  const avg =
    input.turns.length === 0
      ? 0
      : input.turns.reduce((sum, turn) => sum + turn.content_score + turn.logic_score, 0) /
        (input.turns.length * 8);
  const total = Math.round(avg * 1000) / 10;

  return {
    total_score: total,
    competency_scores: {
      "岗位匹配": Math.round(total * 0.25 * 10) / 10,
      "专业能力": Math.round(total * 0.25 * 10) / 10,
      "项目证据": Math.round(total * 0.2 * 10) / 10,
      "逻辑表达": Math.round(total * 0.15 * 10) / 10,
      "复盘成长": Math.round(total * 0.15 * 10) / 10
    },
    strengths: ["能够围绕具体经历回答问题", "已完成完整模拟面试流程"],
    risks: ["部分回答仍需补充量化结果、个人职责和复盘信息"],
    improvements: ["为每个核心项目准备 STAR 结构", "每段经历补齐指标口径、样本范围和个人贡献", "准备 2-3 个协作与复盘案例"],
    report_markdown: `# AI 模拟面试报告\n\n## 整体结果\n\n- 总分：${total} / 100\n- 说明：当前为 Mock 评分结果，接入 Coze 后会按真实工作流评分。\n\n## 优势\n\n- 能够围绕具体经历回答问题。\n- 已完成完整模拟面试流程。\n\n## 待验证项\n\n- 部分回答仍需补充量化结果、个人职责和复盘信息。\n\n## 改进建议\n\n1. 为每个核心项目准备 STAR 结构。\n2. 每段经历补齐指标口径、样本范围和个人贡献。\n3. 准备 2-3 个协作与复盘案例。\n`
  };
}

function inferRole(jd: string): string {
  const compact = jd.replace(/\s+/g, "");
  const match = compact.match(/([\u4e00-\u9fa5A-Za-z]+?(?:工程师|分析师|经理|运营|销售|设计师|顾问|实习生))/);
  return match?.[1] || "目标岗位";
}
