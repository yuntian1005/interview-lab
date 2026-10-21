import { NextResponse } from "next/server";
import { getCurrentUser, unauthorizedResponse } from "@/lib/auth";
import { parseResumeWithCoze } from "@/lib/coze";
import { parseResumeFile } from "@/lib/resumeParser";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthorizedResponse();

  const startedAt = Date.now();
  const formData = await request.formData();
  const file = formData.get("resume_file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "请上传 resume_file 文件。" }, { status: 400 });
  }

  try {
    const cozeParsed = await parseResumeWithCoze(file).catch((error) => {
      console.warn("[resume] Coze parser failed, using local parser result", error);
      return null;
    });
    const parsed = cozeParsed ?? { ...(await parseResumeFile(file)), source: "local" };

    console.log(`[resume] parsed ${parsed.file_name} via ${parsed.source} in ${Date.now() - startedAt}ms`);

    return NextResponse.json(parsed);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "简历解析失败。" },
      { status: 400 }
    );
  }
}
