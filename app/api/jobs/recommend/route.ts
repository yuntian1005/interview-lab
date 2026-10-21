import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser, unauthorizedResponse } from "@/lib/auth";
import { rerankJobsWithDify } from "@/lib/difyJobRecommender";
import { recommendJobs } from "@/lib/jobPresets";
import { recommendJobsFromSqlite } from "@/lib/jobSqliteDb";

const recommendSchema = z.object({
  resume_text: z.string().default(""),
  limit: z.number().int().min(1).max(10).default(5),
  keyword: z.string().trim().max(40).optional()
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthorizedResponse();

  const body = await request.json();
  const parsed = recommendSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { resume_text, limit, keyword } = parsed.data;
  const hasResume = resume_text.trim().length >= 20;
  const hasKeyword = Boolean(keyword?.trim());
  const shouldSkipDifyForTargetRole = /智能体运营|ai智能体运营|意向岗位\s*[:：]\s*.*智能体|期望从事职位\s*[:：]\s*.*智能体/i.test(resume_text);

  if (!hasResume && !hasKeyword) {
    return NextResponse.json({ error: "请先填写简历，或输入想查询的岗位名称。" }, { status: 400 });
  }

  try {
    const candidates = await recommendJobsFromSqlite(resume_text, { keyword, limit: Math.max(30, limit) });
    const difyRecommendations =
      hasResume && !hasKeyword && !shouldSkipDifyForTargetRole
        ? await rerankJobsWithDify({
            resumeText: resume_text,
            keyword,
            limit,
            candidates
          }).catch((error) => {
            console.warn("Dify job recommendation unavailable, falling back to local ranking", error);
            return null;
          })
        : null;
    const recommendations = difyRecommendations ?? candidates.slice(0, limit);

    if (recommendations.length) {
      const exactTargetHint =
        !hasKeyword && recommendations.length < limit
          ? "岗位库中与简历目标岗位强相关的岗位较少，未强行混入不相关开发岗。"
          : "";
      return NextResponse.json({
        recommendations,
        source: difyRecommendations ? "dify_jobs_db" : "jobs_db",
        hint: hasKeyword
          ? `已按岗位名称查询到 ${recommendations.length} 个岗位。`
          : difyRecommendations
            ? `已由 Dify 结合简历和岗位库推荐 ${recommendations.length} 个岗位。`
            : `已根据简历匹配 ${recommendations.length} 个岗位。${exactTargetHint}`
      });
    }
  } catch (error) {
    console.warn("jobs.db recommendation failed", error);
  }

  return NextResponse.json({
    recommendations: hasResume && !hasKeyword ? recommendJobs(resume_text, limit) : [],
    source: "preset_fallback",
    hint: hasKeyword ? "岗位库暂时没有查到相关岗位，请换一个岗位名称试试。" : "岗位数据库暂时没有合适匹配，已生成基础岗位建议。"
  });
}
