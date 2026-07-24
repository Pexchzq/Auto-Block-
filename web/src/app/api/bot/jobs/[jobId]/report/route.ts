import { NextResponse } from "next/server";
import { getDiscordProfileId, verifyBotToken } from "@/lib/discord-bot-api";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ jobId: string }> }) {
  if (!verifyBotToken(request)) {
    return NextResponse.json({ error: "Bot token is invalid" }, { status: 401 });
  }
  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "Supabase admin env is required" }, { status: 503 });

  try {
    const discordUserId = new URL(request.url).searchParams.get("discordUserId");
    const profileId = await getDiscordProfileId(discordUserId);
    if (!profileId) return NextResponse.json({ error: "Discord identity not found" }, { status: 404 });
    const { jobId } = await context.params;

    const { data: job } = await admin
      .from("jobs")
      .select("status")
      .eq("id", jobId)
      .eq("user_id", profileId)
      .single();
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
    if (!["completed", "failed", "cancelled"].includes(String(job.status))) {
      return NextResponse.json({ pending: true, status: job.status }, { status: 409 });
    }

    const { data: report, error } = await admin
      .from("job_reports")
      .select("report_json")
      .eq("job_id", jobId)
      .eq("user_id", profileId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ report: report?.report_json || null });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Report lookup failed" }, { status: 400 });
  }
}
