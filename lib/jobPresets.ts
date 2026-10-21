export type JobPreset = {
  id: string;
  name: string;
  category: string;
  jd: string;
  keywords: string[];
};

export const jobPresets: JobPreset[] = [
  {
    id: "data_analyst",
    name: "数据分析师",
    category: "数据类",
    keywords: ["SQL", "Excel", "Python", "数据", "报表", "指标", "分析", "可视化"],
    jd: "数据分析师岗位，负责业务数据分析、指标体系建设、SQL 报表开发、数据可视化和增长策略支持。要求熟悉 SQL、Excel，了解 Python 或 BI 工具，具备良好的业务理解、逻辑表达和跨部门沟通能力。"
  },
  {
    id: "ai_product_manager",
    name: "AI 产品经理",
    category: "产品类",
    keywords: ["产品", "需求", "原型", "AI", "智能体", "Prompt", "FastGPT", "LangChain", "API", "飞书", "工作流", "用户", "流程"],
    jd: "AI 产品经理岗位，负责 AI 产品需求分析、用户场景梳理、智能体流程设计、Prompt 方案设计、原型与 PRD 输出、跨团队推进和产品效果迭代。要求具备产品思维、用户洞察、AI 工具理解和良好的沟通协调能力。"
  },
  {
    id: "java_backend",
    name: "Java 后端开发",
    category: "技术类",
    keywords: ["Java", "Spring", "MySQL", "Redis", "接口", "API", "后端", "数据库", "微服务", "脚本", "JavaScript"],
    jd: "Java 后端开发岗位，负责业务系统后端接口开发、数据库设计、服务性能优化和系统稳定性保障。要求熟悉 Java、Spring Boot、MySQL、Redis，了解常见后端架构、接口设计、异常处理和基础运维知识。"
  },
  {
    id: "new_media_operator",
    name: "新媒体运营",
    category: "运营类",
    keywords: ["运营", "内容", "小红书", "公众号", "短视频", "增长", "用户", "活动"],
    jd: "新媒体运营岗位，负责内容策划、账号运营、选题生产、用户增长、活动执行和数据复盘。要求具备内容敏感度、热点捕捉能力、文案能力、数据分析意识和跨部门协作能力。"
  },
  {
    id: "sales_consultant",
    name: "销售顾问",
    category: "销售类",
    keywords: ["销售", "客户", "沟通", "转化", "商务", "方案", "跟进", "业绩"],
    jd: "销售顾问岗位，负责客户开发、需求沟通、产品方案介绍、商务跟进、成交转化和客户关系维护。要求具备良好的沟通表达、目标感、抗压能力、客户洞察和问题解决能力。"
  }
];

export function recommendJobs(resumeText: string, limit = 3): Array<JobPreset & { reason: string; score: number }> {
  const normalized = resumeText.toLowerCase();

  return jobPresets
    .map((job) => {
      const matched = job.keywords.filter((keyword) => normalized.includes(keyword.toLowerCase()));
      return {
        ...job,
        score: matched.length,
        reason: matched.length
          ? `简历中出现 ${matched.slice(0, 4).join("、")} 等关键词，和${job.name}岗位较匹配。`
          : `可作为备选方向，建议结合经历补充 ${job.keywords.slice(0, 3).join("、")} 相关证据。`
      };
    })
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "zh-CN"))
    .slice(0, limit);
}
