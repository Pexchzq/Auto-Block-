import { NextResponse } from "next/server";
import { getDiscordProfileId, verifyBotToken } from "@/lib/discord-bot-api";
import { getJobForUser, JobServiceError } from "@/lib/job-service";
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
    const job = await getJobForUser(admin, profileId, jobId);
    return NextResponse.json({ job });
  } catch (error) {
    if (error instanceof JobServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Job lookup failed" }, { status: 400 });
  }
}
