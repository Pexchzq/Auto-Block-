import { NextResponse } from "next/server";
import { validateAccountInput } from "@/lib/accounts";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { confirmJobForUser, jobSummaryFromRow, JobServiceError } from "@/lib/job-service";
import { resolveDiscordProfile, verifyBotToken } from "@/lib/discord-bot-api";
import { getSupabaseAdmin, hasSupabaseAdminConfig } from "@/lib/supabase-server";
import type { BlockMeshMode } from "@/types";

export const runtime = "nodejs";

function freeModeEnabled(): boolean {
  return ["1", "true", "yes"].includes(String(process.env.BOT_FREE_MODE || "").toLowerCase());
}

export async function POST(request: Request) {
  if (!verifyBotToken(request)) {
    return NextResponse.json({ error: "Bot token is invalid" }, { status: 401 });
  }
  if (!hasSupabaseAdminConfig()) {
    return NextResponse.json({ error: "Supabase admin env is required" }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    discordUserId?: string;
    accountText?: string;
    mode?: BlockMeshMode;
    note?: string;
  };
  const accountText = String(body.accountText || "");
  const validation = validateAccountInput(accountText, { required: true, maxAccounts: 500 });
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error || "Invalid account input" }, { status: 400 });
  }

  const rateLimit = checkRateLimit(request, {
    key: `bot:jobs:${String(body.discordUserId || "unknown")}`,
    limit: 5,
    windowMs: 60_000,
  });
  if (!rateLimit.ok) {
    const response = rateLimitResponse(rateLimit.retryAfterSeconds);
    return NextResponse.json(response.body, response.init);
  }

  try {
    const identity = await resolveDiscordProfile(body.discordUserId);
    const admin = getSupabaseAdmin();
    if (!admin) throw new JobServiceError(503, "Supabase admin client unavailable");

    const job = await confirmJobForUser({
      admin,
      userId: identity.profileId,
      accountText,
      accountCount: validation.count,
      mode: body.mode === "stable" ? "stable" : "balanced",
      source: "discord",
      note: String(body.note || `Discord job ${identity.discordUserId}`).slice(0, 200),
      freeMode: freeModeEnabled(),
    });
    return NextResponse.json({ job, freeMode: freeModeEnabled() }, { status: 201 });
  } catch (error) {
    if (error instanceof JobServiceError) {
      return NextResponse.json({ error: error.message, ...(error.details || {}) }, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Discord job create failed" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  if (!verifyBotToken(request)) {
    return NextResponse.json({ error: "Bot token is invalid" }, { status: 401 });
  }
  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "Supabase admin env is required" }, { status: 503 });

  const url = new URL(request.url);
  if (url.searchParams.get("active") !== "1") {
    return NextResponse.json({ jobs: [] });
  }

  const { data: rows, error } = await admin
    .from("jobs")
    .select("*")
    .eq("source", "discord")
    .in("status", ["queued", "running", "retrying"])
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const profileIds = [...new Set((rows || []).map((row) => String(row.user_id)))];
  const { data: identities, error: identityError } = profileIds.length > 0
    ? await admin.from("discord_identities").select("discord_user_id,profile_id").in("profile_id", profileIds)
    : { data: [], error: null };
  if (identityError) return NextResponse.json({ error: identityError.message }, { status: 500 });

  const discordByProfile = new Map((identities || []).map((row) => [String(row.profile_id), String(row.discord_user_id)]));
  return NextResponse.json({
    jobs: (rows || []).flatMap((row) => {
      const discordUserId = discordByProfile.get(String(row.user_id));
      return discordUserId ? [{ discordUserId, job: jobSummaryFromRow(row) }] : [];
    }),
  });
}
