import { NextResponse } from "next/server";
import { isDemoMode } from "@/lib/runtimeMode";

export async function GET() {
  return NextResponse.json({ status: "ok", demo: isDemoMode(), storage: "local-files" });
}
