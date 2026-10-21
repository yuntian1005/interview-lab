import { promises as fs } from "node:fs";
import path from "node:path";
import type { BossJob, BossSearchInput } from "@/lib/bossJobs";

type CacheEntry = {
  key: string;
  jobs: BossJob[];
  updated_at: string;
};

type CacheDb = {
  entries: CacheEntry[];
};

const dataDir = path.join(process.cwd(), "data");
const cachePath = path.join(dataDir, "boss_jobs_cache.json");
const ttlMs = 30 * 60 * 1000;

export function makeBossCacheKey(input: BossSearchInput) {
  return [input.keyword, input.city ?? "", input.address ?? "", String(input.limit)].map((item) => item.trim()).join("|");
}

export async function readBossJobCache(key: string, options?: { allowStale?: boolean }) {
  const db = await readCacheDb();
  const entry = db.entries.find((item) => item.key === key);
  if (!entry) return null;

  const ageMs = Date.now() - new Date(entry.updated_at).getTime();
  if (!options?.allowStale && ageMs > ttlMs) return null;

  return {
    jobs: entry.jobs,
    updated_at: entry.updated_at,
    stale: ageMs > ttlMs
  };
}

export async function writeBossJobCache(key: string, jobs: BossJob[]) {
  const db = await readCacheDb();
  const now = new Date().toISOString();
  const nextEntry: CacheEntry = { key, jobs, updated_at: now };
  const index = db.entries.findIndex((item) => item.key === key);

  if (index >= 0) {
    db.entries[index] = nextEntry;
  } else {
    db.entries.unshift(nextEntry);
  }

  db.entries = db.entries.slice(0, 80);
  await fs.writeFile(cachePath, JSON.stringify(db, null, 2), "utf8");
  return nextEntry;
}

async function readCacheDb(): Promise<CacheDb> {
  await fs.mkdir(dataDir, { recursive: true });

  try {
    const raw = await fs.readFile(cachePath, "utf8");
    return JSON.parse(raw) as CacheDb;
  } catch {
    return { entries: [] };
  }
}
