import { promises as fs } from "node:fs";
import path from "node:path";
import initSqlJs from "sql.js";
import type { JobPreset } from "@/lib/jobPresets";

export type SqliteJobRecommendation = JobPreset & {
  reason: string;
  score: number;
};

type SqliteJobRow = {
  id: number;
  source: string;
  title: string;
  normalized_title: string;
  family_key: string;
  jd: string;
};

type ResumeProfile = {
  raw: string;
  desiredRole: string;
  targetTitleTerms: string[];
  skillTerms: string[];
  blockedTitleTerms: string[];
  isKeywordOnly: boolean;
  isTechnical: boolean;
  isAgentOps: boolean;
};

const dbPath = path.join(process.cwd(), "data", "jobs.db");
const snapshotPath = path.join(process.cwd(), "data", "jobs_snapshot.json");

const techSkillTerms = [
  "java",
  "spring",
  "springboot",
  "springcloud",
  "springmvc",
  "mybatis",
  "mysql",
  "redis",
  "mongodb",
  "rabbitmq",
  "elasticsearch",
  "docker",
  "kubernetes",
  "微服务",
  "分布式",
  "高并发",
  "接口",
  "sql",
  "jwt",
  "javascript",
  "node",
  "vue",
  "react",
  "python",
  "langchain",
  "fastgpt",
  "dify",
  "prompt"
];

const softwareDevTitleTerms = ["全栈", "前端", "后端", "服务端", "java开发", "软件开发", "研发工程师", "开发工程师"];
const nonTechTitleTerms = ["销售", "推广", "商务", "店员", "客服", "客户经理", "顾问", "主播", "运营", "市场", "专员", "助理", "外贸", "置业", "保险"];
const genericTerms = ["客户", "需求", "产品", "项目", "沟通", "设计", "管理"];
const roleSynonyms: Array<{ pattern: RegExp; terms: string[]; blocked?: string[] }> = [
  {
    pattern: /java|后端|服务端|研发|软件开发|开发工程师/,
    terms: ["java", "java开发", "java工程师", "后端", "后端开发", "服务端", "研发工程师", "开发工程师", "软件工程师"],
    blocked: nonTechTitleTerms
  },
  {
    pattern: /数据分析|数据运营|商业分析|bi|报表|指标/,
    terms: ["数据分析", "数据分析师", "数据运营", "商业分析", "bi", "报表", "指标", "sql"],
    blocked: ["销售", "客服", "店员", "主播", "置业", "保险"]
  },
  {
    pattern: /产品经理|ai产品|产品助理|产品运营/,
    terms: ["产品经理", "产品助理", "产品运营", "ai产品", "需求分析", "原型", "prd"],
    blocked: ["销售", "客服", "店员", "主播", "置业", "保险"]
  },
  {
    pattern: /智能体|ai应用|大模型应用|大模型运营|prompt|提示词/,
    terms: ["智能体", "ai智能体", "智能体运营", "智能体应用", "ai应用", "大模型应用", "大模型运营", "prompt", "提示词", "工作流"],
    blocked: ["销售", "客服", "店员", "主播", "置业", "保险"]
  },
  {
    pattern: /新媒体|内容运营|用户运营|运营专员|小红书|公众号|短视频/,
    terms: ["新媒体运营", "内容运营", "用户运营", "运营专员", "小红书", "公众号", "短视频"],
    blocked: softwareDevTitleTerms
  },
  {
    pattern: /销售|客户经理|商务|顾问/,
    terms: ["销售", "销售顾问", "客户经理", "商务", "销售工程师", "渠道销售"],
    blocked: softwareDevTitleTerms
  }
];

export async function recommendJobsFromSqlite(resumeText: string, options?: { keyword?: string; limit?: number }) {
  const limit = Math.max(1, Math.min(10, options?.limit ?? 5));
  const keyword = options?.keyword?.trim();
  const profile = buildResumeProfile(resumeText, keyword);
  const jobs = await readAvailableJobs(profile, keyword);

  return jobs
    .map((job) => scoreJob(job, profile, keyword))
    .filter((job) => job.score >= (profile.isKeywordOnly ? 45 : 58))
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name, "zh-CN"))
    .slice(0, limit);
}

async function readAvailableJobs(profile: ResumeProfile, keyword?: string) {
  try {
    const sqliteJobs = await readJobsFromSqlite(profile, keyword);
    if (sqliteJobs.length) return sqliteJobs;
  } catch (error) {
    console.warn("read jobs.db failed, falling back to jobs_snapshot.json", error);
  }

  const snapshotJobs = await readJobsFromSnapshot(profile, keyword);
  if (snapshotJobs.length) return snapshotJobs;

  return readJobsFromSnapshot({ ...profile, targetTitleTerms: [], skillTerms: [] });
}

async function readJobsFromSqlite(profile: ResumeProfile, keyword?: string): Promise<SqliteJobRow[]> {
  const fileBuffer = await fs.readFile(dbPath);
  const SQL = await initSqlJs({
    locateFile: (file) => path.join(process.cwd(), "node_modules", "sql.js", "dist", file)
  });
  const db = new SQL.Database(fileBuffer);

  try {
    const rows = new Map<number, SqliteJobRow>();
    for (const term of buildSearchTerms(profile, keyword)) {
      const statement = db.prepare(
        profile.isKeywordOnly
          ? `
              select id, source, title, normalized_title, family_key, jd
              from jobs
              where title like $term
                or normalized_title like $term
                or family_key like $term
              limit 300
            `
          : `
              select id, source, title, normalized_title, family_key, jd
              from jobs
              where title like $term
                or normalized_title like $term
                or family_key like $term
                or jd like $term
              limit 450
            `
      );
      statement.bind({ $term: `%${term}%` });
      while (statement.step()) {
        const job = toJobRow(statement.getAsObject() as Record<string, unknown>);
        rows.set(job.id, job);
      }
      statement.free();
    }
    return Array.from(rows.values());
  } finally {
    db.close();
  }
}

async function readJobsFromSnapshot(profile: ResumeProfile, keyword?: string): Promise<SqliteJobRow[]> {
  const raw = await fs.readFile(snapshotPath, "utf8");
  const payload = JSON.parse(raw) as { jobs?: SqliteJobRow[] };
  const jobs = payload.jobs ?? [];
  const searchTerms = buildSearchTerms(profile, keyword).map(normalize);
  if (!searchTerms.length) return jobs.slice(0, 1200);

  return jobs
    .filter((job) => {
      const titleHaystack = normalize(`${job.title}${job.normalized_title}${job.family_key}`);
      const fullHaystack = normalize(`${job.title}${job.normalized_title}${job.family_key}${job.jd}`);
      const haystack = profile.isKeywordOnly ? titleHaystack : fullHaystack;
      return searchTerms.some((term) => haystack.includes(term));
    })
    .slice(0, 1200);
}

function buildResumeProfile(resumeText: string, keyword?: string): ResumeProfile {
  const source = `${resumeText} ${keyword ?? ""}`;
  const raw = normalize(source);
  const desiredRole = extractDesiredRole(resumeText);
  const desired = normalize(desiredRole);
  const normalizedKeyword = normalize(keyword ?? "");
  const isKeywordOnly = resumeText.trim().length < 20 && Boolean(keyword?.trim());
  const javaIntent = /\bjava\b/i.test(source) || raw.includes("java开发") || raw.includes("java后端");
  const backendIntent = ["后端", "服务端", "springboot", "springcloud", "mybatis", "微服务"].some((term) => raw.includes(normalize(term)));
  const isAgentOps = /智能体|ai应用|大模型应用|prompt|提示词/.test(desired || normalizedKeyword);
  const isTechnical = javaIntent || backendIntent || techSkillTerms.some((term) => raw.includes(normalize(term)));

  const targetTitleTerms = new Set<string>();
  if (keyword?.trim()) addRoleTerms(targetTitleTerms, keyword.trim());
  if (desiredRole) addRoleTerms(targetTitleTerms, desiredRole);
  for (const rule of roleSynonyms) {
    if (rule.pattern.test(raw) || rule.pattern.test(desired) || rule.pattern.test(normalizedKeyword)) {
      rule.terms.forEach((term) => targetTitleTerms.add(term));
    }
  }
  if (javaIntent) ["java", "java开发", "java工程师", "后端", "服务端", "研发工程师"].forEach((term) => targetTitleTerms.add(term));
  if (backendIntent) ["后端", "服务端", "开发工程师", "软件工程师"].forEach((term) => targetTitleTerms.add(term));
  if (isAgentOps) ["智能体", "ai智能体", "智能体运营", "智能体应用", "ai应用", "大模型应用", "prompt", "提示词"].forEach((term) => targetTitleTerms.add(term));

  const blockedTitleTerms = new Set<string>();
  if (isTechnical) nonTechTitleTerms.forEach((term) => blockedTitleTerms.add(term));
  if (isAgentOps && /运营|应用|产品/.test(desired || normalizedKeyword)) {
    softwareDevTitleTerms.forEach((term) => blockedTitleTerms.add(term));
  }
  for (const rule of roleSynonyms) {
    if (rule.blocked && (rule.pattern.test(raw) || rule.pattern.test(desired) || rule.pattern.test(normalizedKeyword))) {
      rule.blocked.forEach((term) => blockedTitleTerms.add(term));
    }
  }

  return {
    raw,
    desiredRole,
    targetTitleTerms: Array.from(targetTitleTerms),
    skillTerms: techSkillTerms.filter((term) => raw.includes(normalize(term))),
    blockedTitleTerms: Array.from(blockedTitleTerms),
    isKeywordOnly,
    isTechnical,
    isAgentOps
  };
}

function extractDesiredRole(resumeText: string) {
  const patterns = [
    /(?:期望从事职位|意向岗位|求职意向|目标岗位|应聘岗位|期望职位)\s*[:：]\s*([^\n\r|，,；;]+)/i,
    /(?:岗位|职位)\s*[:：]\s*([^\n\r|，,；;]+)/i
  ];

  for (const pattern of patterns) {
    const match = resumeText.match(pattern)?.[1]?.trim();
    if (match) return match.slice(0, 30);
  }

  return "";
}

function addRoleTerms(target: Set<string>, role: string) {
  const cleaned = role.replace(/[()（）【】\[\]「」]/g, " ").trim();
  if (!cleaned) return;
  target.add(cleaned);
  cleaned
    .split(/[\/｜|、,，\s]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2)
    .forEach((item) => target.add(item));
  splitCommonRoleTerms(cleaned).forEach((item) => target.add(item));
}

function buildSearchTerms(profile: ResumeProfile, keyword?: string) {
  return unique([
    keyword?.trim(),
    profile.desiredRole,
    ...profile.targetTitleTerms,
    ...(profile.isKeywordOnly ? [] : profile.skillTerms.slice(0, 6))
  ])
    .filter((term) => normalize(term).length >= 2)
    .slice(0, 16);
}

function scoreJob(job: SqliteJobRow, profile: ResumeProfile, keyword?: string): SqliteJobRecommendation {
  const titleText = `${job.title}${job.normalized_title}`;
  const title = normalize(titleText);
  const family = normalize(job.family_key);
  const jd = normalize(job.jd);
  const titleHaystack = title;
  const fullHaystack = `${title}${family}${jd}`;
  const normalizedKeyword = normalize(keyword ?? "");
  const desiredRoleHit = Boolean(profile.desiredRole && titleHaystack.includes(normalize(profile.desiredRole)));
  const titleHits = profile.targetTitleTerms.filter((term) => titleHaystack.includes(normalize(term)));
  const familyHits = profile.targetTitleTerms.filter((term) => !titleHaystack.includes(normalize(term)) && family.includes(normalize(term)));
  const skillHits = profile.isKeywordOnly ? [] : profile.skillTerms.filter((term) => fullHaystack.includes(normalize(term)));
  const blockedTitleHits = profile.blockedTitleTerms.filter((term) => title.includes(normalize(term)));
  const keywordTitleHit = Boolean(normalizedKeyword && titleHaystack.includes(normalizedKeyword));
  const keywordAnyHit = Boolean(normalizedKeyword && fullHaystack.includes(normalizedKeyword));
  const genericHits = profile.isKeywordOnly ? [] : genericTerms.filter((term) => profile.raw.includes(normalize(term)) && fullHaystack.includes(normalize(term)));

  let score = profile.isKeywordOnly ? 18 : 26;
  if (desiredRoleHit) score += 48;
  score += titleHits.length * 20;
  score += Math.min(familyHits.length, 2) * 4;
  score += skillHits.length * 5;
  score += Math.min(genericHits.length, 2) * 1;
  if (keywordTitleHit) score += 44;
  else if (!profile.isKeywordOnly && keywordAnyHit) score += 8;
  if (profile.isTechnical && (family.includes("tech_dev") || title.includes("开发") || title.includes("工程师"))) score += 10;
  if (profile.isAgentOps && (title.includes("智能体") || title.includes("大模型") || title.includes("ai"))) score += 18;
  if (profile.isTechnical && title.includes("javascript") && profile.raw.includes("java") && !profile.raw.includes("javascript")) score -= 30;
  if (blockedTitleHits.length) score -= profile.isAgentOps ? 45 : 55;
  if (profile.isKeywordOnly && !keywordTitleHit) score -= 35;
  if (profile.desiredRole && !desiredRoleHit && !titleHits.length) score -= 20;
  if (job.jd.length >= 120) score += 3;
  score = Math.max(0, Math.min(98, score));

  const evidence = unique([...(desiredRoleHit ? [profile.desiredRole] : []), ...titleHits, ...familyHits, ...skillHits]).slice(0, 6);
  const reason = evidence.length
    ? `匹配到 ${evidence.join("、")}，优先参考简历中的目标岗位和岗位名称。`
    : keywordAnyHit
      ? `岗位名称或 JD 与“${keyword?.trim()}”相关，可点开核对岗位真实性。`
      : "该岗位与简历存在一定相关性，可作为备选方向进一步核对。";

  return {
    id: `db_job_${job.id}`,
    name: job.title,
    category: job.source ? `${job.source} 岗位库` : "岗位库",
    keywords: evidence.length ? evidence : extractKeywordsFromJob(job),
    jd: job.jd,
    reason,
    score
  };
}

function extractKeywordsFromJob(job: SqliteJobRow) {
  const haystack = normalize(`${job.title}${job.family_key}${job.jd}`);
  return unique([...techSkillTerms, "智能体", "大模型", "ai", "运营", "产品"].filter((item) => haystack.includes(normalize(item)))).slice(0, 6);
}

function toJobRow(row: Record<string, unknown>): SqliteJobRow {
  return {
    id: Number(row.id),
    source: String(row.source ?? ""),
    title: String(row.title ?? ""),
    normalized_title: String(row.normalized_title ?? ""),
    family_key: String(row.family_key ?? ""),
    jd: String(row.jd ?? "")
  };
}

function unique(items: Array<string | undefined>) {
  return Array.from(new Set(items.map((item) => item?.trim()).filter(Boolean))) as string[];
}

function normalize(text = "") {
  return text
    .toLowerCase()
    .replace(/[（(].*?[）)]/g, "")
    .replace(/[\s\-_/｜|、,，.。:：;；]+/g, "")
    .trim();
}

function splitCommonRoleTerms(role: string) {
  const normalized = normalize(role);
  const terms = new Set<string>();
  const known = [
    "java",
    "ai",
    "后端",
    "前端",
    "服务端",
    "开发",
    "研发",
    "工程师",
    "产品",
    "经理",
    "运营",
    "数据",
    "分析",
    "智能体",
    "大模型",
    "提示词",
    "销售",
    "商务",
    "客服",
    "新媒体",
    "短视频"
  ];

  known.forEach((term) => {
    if (normalized.includes(normalize(term))) terms.add(term);
  });

  if (normalized.includes("后端") && normalized.includes("开发")) terms.add("后端开发");
  if (normalized.includes("数据") && normalized.includes("分析")) terms.add("数据分析");
  if (normalized.includes("产品") && normalized.includes("经理")) terms.add("产品经理");
  if (normalized.includes("新媒体") && normalized.includes("运营")) terms.add("新媒体运营");

  return Array.from(terms);
}
