import { NextResponse } from "next/server";
import { resolveDiscordProfile, verifyBotToken } from "@/lib/discord-bot-api";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { topUpWalletWithVoucher, TopUpServiceError } from "@/lib/top-up-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!verifyBotToken(request)) {
    return NextResponse.json({ error: "Bot token is invalid" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    discordUserId?: string;
    voucherUrl?: string;
  };
  const rateLimit = checkRateLimit(request, {
    key: `bot:wallet:topup:${String(body.discordUserId || "unknown")}`,
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
    if (!admin) return NextResponse.json({ error: "Supabase admin env is required" }, { status: 503 });

    return NextResponse.json(await topUpWalletWithVoucher({
      admin,
      userId: identity.profileId,
      voucherUrl: String(body.voucherUrl || ""),
    }));
  } catch (error) {
    if (error instanceof TopUpServiceError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Discord top-up failed" }, { status: 500 });
  }
}
