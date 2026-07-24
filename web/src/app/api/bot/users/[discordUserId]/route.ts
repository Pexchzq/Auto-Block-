import { NextResponse } from "next/server";
import { getDiscordProfileId, verifyBotToken } from "@/lib/discord-bot-api";
import { jobSummaryFromRow } from "@/lib/job-service";
import { getSupabaseAdmin, getWalletBalanceBaht } from "@/lib/supabase-server";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ discordUserId: string }> }) {
  if (!verifyBotToken(request)) {
    return NextResponse.json({ error: "Bot token is invalid" }, { status: 401 });
  }
  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "Supabase admin env is required" }, { status: 503 });

  try {
    const { discordUserId } = await context.params;
    const profileId = await getDiscordProfileId(discordUserId);
    if (!profileId) {
      return NextResponse.json({ discordUserId, registered: false, balanceBaht: 0, jobs: [] });
    }

    const [{ data: jobs, error }, balanceBaht] = await Promise.all([
      admin.from("jobs").select("*").eq("user_id", profileId).order("created_at", { ascending: false }).limit(10),
      getWalletBalanceBaht(profileId),
    ]);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({
      discordUserId,
      registered: true,
      balanceBaht,
      jobs: (jobs || []).map((row) => jobSummaryFromRow(row)),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "User lookup failed" }, { status: 400 });
  }
}
