import { promises as fs } from "node:fs";
import path from "node:path";
import type { BossJob } from "@/lib/bossJobs";

export type StoredJobPost = BossJob & {
  normalized_title: string;
  collected_at: string;
  updated_at: string;
};

type JobPostDb = {
  jobs: StoredJobPost[];
};

const dataDir = path.join(process.cwd(), "data");
const jobPostPath = path.join(dataDir, "job_posts.json");

export async function listJobPosts(filters?: { keyword?: string; city?: string; address?: string }) {
  const db = await readJobPostDb();
  const keyword = normalize(filters?.keyword ?? "");
  const city = normalize(filters?.city ?? "");
  const address = normalize(filters?.address ?? "");

  return db.jobs
    .filter((job) => {
      const haystack = normalize([job.name, job.company, job.location, job.jd, ...job.tags].join(" "));
      if (keyword && !haystack.includes(keyword)) return false;
      if (city && !haystack.includes(city)) return false;
      if (address && !haystack.includes(address)) return false;
      return true;
    })
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
}

export async function upsertJobPosts(jobs: BossJob[]) {
  const db = await readJobPostDb();
  const now = new Date().toISOString();
  const byTitle = new Map(db.jobs.map((job) => [job.normalized_title, job]));
  let inserted = 0;
  let updated = 0;

  for (const job of jobs) {
    const normalizedTitle = normalizeJobTitle(job.name);
    if (!normalizedTitle || !isUsefulJob(job)) continue;

    const existing = byTitle.get(normalizedTitle);
    const nextJob: StoredJobPost = {
      ...job,
      normalized_title: normalizedTitle,
      collected_at: existing?.collected_at ?? now,
      updated_at: now
    };

    if (!existing) {
      byTitle.set(normalizedTitle, nextJob);
      inserted += 1;
      continue;
    }

    if (jobCompleteness(nextJob) >= jobCompleteness(existing)) {
      byTitle.set(normalizedTitle, nextJob);
      updated += 1;
    }
  }

  const nextJobs = Array.from(byTitle.values()).sort((left, right) => right.updated_at.localeCompare(left.updated_at));
  await writeJobPostDb({ jobs: nextJobs });

  return {
    inserted,
    updated,
    total: nextJobs.length
  };
}

async function readJobPostDb(): Promise<JobPostDb> {
  await fs.mkdir(dataDir, { recursive: true });

  try {
    const raw = await fs.readFile(jobPostPath, "utf8");
    return JSON.parse(raw) as JobPostDb;
  } catch {
    return { jobs: [] };
  }
}

async function writeJobPostDb(db: JobPostDb) {
  await fs.writeFile(jobPostPath, JSON.stringify(db, null, 2), "utf8");
}

function normalizeJobTitle(title: string) {
  return normalize(title)
    .replace(/高级|资深|初级|中级|实习|校招|社招|专家|leader|负责人|主管|经理|总监/gi, "")
    .replace(/\d+[kK]?[-~到至]\d+[kK]?/g, "")
    .trim();
}

function normalize(text: string) {
  return text.toLowerCase().replace(/\s+/g, "").trim();
}

function isUsefulJob(job: BossJob) {
  if (!job.name || !job.jd || job.jd.length < 80) return false;
  if (/请稍候|安全验证|访问异常|验证码|加载中|document\.createElement|ka\.v1|<script/i.test(job.jd)) return false;
  return /岗位|职位|职责|要求|工作内容|任职|经验|负责|产品|用户|团队/.test(job.jd);
}

function jobCompleteness(job: StoredJobPost) {
  return [job.company, job.location, job.salary, job.experience, job.jd, ...job.tags].filter(Boolean).join("").length;
}
