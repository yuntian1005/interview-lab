import { readFileSync } from "fs";
import path from "path";

type QuestionBankItem = {
  source: string;
  category: string;
  question: string;
};

const fallbackQuestions: QuestionBankItem[] = [
  {
    source: "fallback",
    category: "通用",
    question: "请结合一个具体项目，说明你如何定义问题、拆解任务并验证最终结果。"
  },
  {
    source: "fallback",
    category: "通用",
    question: "当项目中出现结果不符合预期时，你会如何定位原因并推进改进？"
  }
];

export function getQuestionBankContext(input: {
  jobRole: string;
  jdText: string;
  difficulty: string;
  questionCount: number;
}): string {
  const items = loadQuestionBank();
  const query = `${input.jobRole} ${input.jdText}`.toLowerCase();
  const keywords = extractKeywords(query);

  const scored = items
    .map((item) => {
      const haystack = `${item.category} ${item.question}`.toLowerCase();
      const score = keywords.reduce((sum, keyword) => sum + (haystack.includes(keyword) ? 1 : 0), 0);
      return { ...item, score };
    })
    .sort((a, b) => b.score - a.score || b.question.length - a.question.length);

  const selected = scored.filter((item) => item.score > 0).slice(0, 12);
  const finalItems = selected.length ? selected : scored.slice(0, 8);

  return [
    "以下是本地岗位题库中检索到的参考问题。你可以借鉴题型和考察方向，但不要机械照搬；仍需结合候选人简历、岗位 JD、难度和题目数量生成自然问题。",
    `当前难度：${input.difficulty}`,
    `配置题目数量：${input.questionCount}`,
    "",
    ...finalItems.map((item, index) => `${index + 1}. [${item.category}] ${item.question}`)
  ].join("\n");
}

function loadQuestionBank(): QuestionBankItem[] {
  try {
    const filePath = path.join(process.cwd(), "data", "question_bank.json");
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as QuestionBankItem[];
    return parsed.length ? parsed : fallbackQuestions;
  } catch {
    return fallbackQuestions;
  }
}

function extractKeywords(text: string): string[] {
  const base = [
    "ai",
    "智能体",
    "prompt",
    "fastgpt",
    "langchain",
    "api",
    "飞书",
    "java",
    "python",
    "sql",
    "数据",
    "产品",
    "运营",
    "销售",
    "后端",
    "算法",
    "rag",
    "知识库",
    "大模型",
    "接口",
    "项目",
    "沟通",
    "协作"
  ];
  const dynamic = text
    .split(/[\s,，。；;、/|()（）:：]+/)
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length >= 2 && item.length <= 24);

  return Array.from(new Set([...base.filter((keyword) => text.includes(keyword)), ...dynamic])).slice(0, 80);
}
