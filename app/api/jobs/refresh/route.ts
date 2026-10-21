import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser, unauthorizedResponse } from "@/lib/auth";
import { searchBossJobs } from "@/lib/bossJobs";
import { upsertJobPosts } from "@/lib/jobPostDb";
import { isDemoMode } from "@/lib/runtimeMode";

const refreshSchema = z.object({
  keyword: z.string().trim().min(1).max(40).default("AI 产品经理"),
  city: z.string().trim().max(40).optional(),
  address: z.string().trim().max(80).optional(),
  limit: z.number().int().min(1).max(30).default(20)
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthorizedResponse();
  if (isDemoMode()) return NextResponse.json({ error: "演示模式使用本地岗位预设，不抓取外部招聘网站。" }, { status: 503 });

  const body = await request.json();
  const parsed = refreshSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const jobs = await searchBossJobs(parsed.data);
    const result = await upsertJobPosts(jobs);

    return NextResponse.json({
      ok: true,
      collected: jobs.length,
      ...result
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? `岗位库刷新失败：${error.message}` : "岗位库刷新失败。"
      },
      { status: 502 }
    );
  }
}
