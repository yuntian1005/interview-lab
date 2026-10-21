import { chromium, type BrowserContext, type Page } from "playwright";
import { existsSync } from "node:fs";
import path from "node:path";

export type BossJob = {
  id: string;
  name: string;
  company: string;
  location: string;
  salary: string;
  experience: string;
  education: string;
  tags: string[];
  url: string;
  jd: string;
  source: "boss";
};

export type BossSearchInput = {
  keyword: string;
  city?: string;
  address?: string;
  limit: number;
};

type BossJobCard = Omit<BossJob, "id" | "jd" | "source">;

const BOSS_HOME = "https://www.zhipin.com";
const DETAIL_JD_MIN_LENGTH = 80;

export async function searchBossJobs(input: BossSearchInput): Promise<BossJob[]> {
  const keyword = [input.keyword, input.city, input.address].filter(Boolean).join(" ");
  const targetUrl = `${BOSS_HOME}/web/geek/job?query=${encodeURIComponent(keyword)}`;
  const storageState = getBossStorageStatePath();
  const browser = await chromium.launch({
    headless: process.env.BOSS_HEADLESS !== "false",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled"]
  });

  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      viewport: { width: 1366, height: 900 },
      storageState
    });
    const page = await context.newPage();
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(1800);
    await assertBossPageAvailable(page);

    const cards = await collectJobCards(page, input.limit);
    const jobs: BossJob[] = [];

    for (const [index, card] of cards.entries()) {
      if (jobs.length >= input.limit) break;

      const detail = await collectJobDetail(context, card, index);
      if (!detail || detail.jd.length < DETAIL_JD_MIN_LENGTH) continue;

      jobs.push({
        ...card,
        name: detail.name || card.name,
        id: normalizeId(card.url || `${detail.name || card.name}_${card.company}_${index}`),
        jd: detail.jd,
        source: "boss"
      });
    }

    return jobs;
  } finally {
    await browser.close();
  }
}

export function scoreBossJobsByResume(jobs: BossJob[], resumeText: string) {
  const normalized = resumeText.toLowerCase();
  return jobs
    .map((job) => {
      const keywords = [job.name, job.company, job.location, job.jd, ...job.tags]
        .flatMap((item) => item.split(/[\s,，、|/]+/))
        .map((item) => item.trim())
        .filter((item) => item.length >= 2 && item.length <= 18);
      const matched = Array.from(new Set(keywords.filter((keyword) => normalized.includes(keyword.toLowerCase()))));
      const score = Math.min(100, 62 + matched.length * 5 + (job.jd.length > 300 ? 8 : 0));
      return {
        ...job,
        score,
        reason: matched.length
          ? `Boss 真实岗位 JD 与简历中的 ${matched.slice(0, 4).join("、")} 等信息匹配，适合用于模拟面试。`
          : `Boss 真实岗位 JD 已入库，可结合简历继续补充 ${job.tags.slice(0, 4).join("、") || job.name} 相关经历。`
      };
    })
    .sort((left, right) => right.score - left.score);
}

async function collectJobCards(page: Page, limit: number): Promise<BossJobCard[]> {
  const cards = await page.$$eval(
    ".job-card-wrapper, .job-list-box li, .job-primary, .job-card-body",
    (nodes, maxCount) =>
      nodes.slice(0, Number(maxCount) * 3).map((card) => {
        const pick = (selectors: string[]) => {
          for (const selector of selectors) {
            const value = card.querySelector(selector)?.textContent?.trim();
            if (value) return value.replace(/\s+/g, " ");
          }
          return "";
        };
        const link = card.querySelector<HTMLAnchorElement>("a[href*='/job_detail/'], a[href]")?.href ?? "";
        const tags = Array.from(card.querySelectorAll(".tag-list li, .job-card-footer li, .info-desc, .job-tags span"))
          .map((item) => item.textContent?.trim() ?? "")
          .filter(Boolean)
          .slice(0, 8);

        return {
          name: pick([".job-name", ".job-title", ".job-title-name", ".job-info .name"]),
          company: pick([".company-name", ".company-text .name", ".company-info .name", ".boss-name"]),
          location: pick([".job-area", ".job-location", ".location"]),
          salary: pick([".salary", ".red", ".job-limit .red"]),
          experience: pick([".job-limit", ".job-info .tag-list", ".job-card-left"]),
          education: pick([".job-limit", ".job-info .tag-list", ".job-card-left"]),
          tags,
          url: link
        };
      }),
    limit
  );

  return cards
    .map((card) => ({
      ...card,
      url: normalizeBossUrl(card.url)
    }))
    .filter((card) => card.name && card.url.includes("/job_detail/"));
}

async function collectJobDetail(context: BrowserContext, card: BossJobCard, index: number) {
  const page = await context.newPage();

  try {
    await page.waitForTimeout(500 + index * 120);
    await page.goto(card.url, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(1000);
    await assertBossPageAvailable(page);

    const detail = await page.evaluate(() => {
      const pick = (selectors: string[]) => {
        for (const selector of selectors) {
          const value = document.querySelector(selector)?.textContent?.trim();
          if (value) return value.replace(/\s+/g, " ");
        }
        return "";
      };
      const title = pick([".job-title", ".job-name", ".name", "h1"]);
      const jdSelectors = [
        ".job-sec-text",
        ".job-detail-section",
        ".job-detail",
        ".detail-content",
        ".job-detail-container",
        ".detail-bottom-text",
        ".text"
      ];
      const parts = jdSelectors
        .map((selector) => document.querySelector(selector)?.textContent?.trim() ?? "")
        .filter(Boolean);
      const fallback = document.body?.textContent?.trim() ?? "";

      return {
        name: title,
        text: (parts.length ? parts.join("\n\n") : fallback).replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n")
      };
    });

    const jd = cleanBossJd(detail.text, card);
    return {
      name: detail.name,
      jd
    };
  } catch {
    return null;
  } finally {
    await page.close();
  }
}

async function assertBossPageAvailable(page: Page) {
  const title = await page.title().catch(() => "");
  const content = await page.textContent("body").catch(() => "");
  const text = `${title}\n${content}`;

  if (/验证码|captcha|登录|安全检查|访问异常|请完成验证|请先登录/i.test(text)) {
    throw new Error("Boss 直聘需要登录或验证，已停止抓取。请先刷新登录态，或稍后再试。");
  }
}

function cleanBossJd(text: string, card: BossJobCard) {
  const lines = text
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((line) => !/立即沟通|投递简历|举报|收藏|分享|下载APP|使用APP|扫码|微信|登录|注册/.test(line));

  const startIndex = lines.findIndex((line) => /职位描述|岗位职责|任职要求|工作内容|岗位要求|职位详情/i.test(line));
  const selected = (startIndex >= 0 ? lines.slice(startIndex) : lines).slice(0, 80);
  const jdBody = selected.join("\n");

  return [
    `岗位名称：${card.name}`,
    card.company ? `公司：${card.company}` : "",
    card.location ? `地点：${card.location}` : "",
    card.salary ? `薪资：${card.salary}` : "",
    card.tags.length ? `标签：${card.tags.join("、")}` : "",
    "",
    jdBody
  ]
    .filter((item) => item !== "")
    .join("\n")
    .trim();
}

function normalizeBossUrl(value: string) {
  if (!value) return "";
  if (value.startsWith("http")) return value;
  if (value.startsWith("//")) return `https:${value}`;
  if (value.startsWith("/")) return `${BOSS_HOME}${value}`;
  return value;
}

function normalizeId(value: string) {
  return value
    .replace(/https?:\/\//g, "")
    .replace(/[^a-zA-Z0-9_\u4e00-\u9fa5]+/g, "_")
    .slice(0, 80);
}

function getBossStorageStatePath() {
  const customPath = process.env.BOSS_STORAGE_STATE;
  if (customPath && existsSync(customPath)) return customPath;

  const defaultPath = path.join(process.cwd(), "storage", "boss-storage-state.json");
  return existsSync(defaultPath) ? defaultPath : undefined;
}
