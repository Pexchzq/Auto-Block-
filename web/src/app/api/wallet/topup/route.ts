import { NextResponse } from "next/server";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { getSupabaseAdmin, getUserIdFromRequest, hasSupabaseAdminConfig } from "@/lib/supabase-server";
import { topUpWalletWithVoucher, TopUpServiceError } from "@/lib/top-up-service";
import type { WalletTopUpRequest } from "@/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const rateLimit = checkRateLimit(request, { key: "wallet:topup", limit: 10, windowMs: 60_000 });
  if (!rateLimit.ok) {
    const response = rateLimitResponse(rateLimit.retryAfterSeconds);
    return NextResponse.json(response.body, response.init);
  }

  const body = (await request.json().catch(() => ({}))) as Partial<WalletTopUpRequest>;
  if (!hasSupabaseAdminConfig()) {
    return NextResponse.json({ error: "Supabase admin env is required for wallet top-up" }, { status: 503 });
  }
  const admin = getSupabaseAdmin();
  const userId = await getUserIdFromRequest(request);
  if (!admin || !userId) {
    return NextResponse.json({ error: "Login is required before topping up wallet" }, { status: 401 });
  }

  try {
    return NextResponse.json(await topUpWalletWithVoucher({
      admin,
      userId,
      voucherUrl: String(body.voucherUrl || ""),
    }));
  } catch (error) {
    if (error instanceof TopUpServiceError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return NextResponse.json({ error: "Wallet top-up failed" }, { status: 500 });
  }
}
