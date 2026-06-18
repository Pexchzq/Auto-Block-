import { NextResponse } from "next/server";
import { resolveAccountCount } from "@/lib/accounts";
import { createQuote } from "@/lib/pricing";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import type { BlockMeshMode, QuoteRequest } from "@/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const rateLimit = checkRateLimit(request, { key: "quote", limit: 120, windowMs: 60_000 });
  if (!rateLimit.ok) {
    const response = rateLimitResponse(rateLimit.retryAfterSeconds);
    return NextResponse.json(response.body, response.init);
  }

  const body = (await request.json().catch(() => ({}))) as Partial<QuoteRequest>;
  const accountCount = resolveAccountCount(body);
  const mode = body.mode === "stable" ? "stable" : ("balanced" satisfies BlockMeshMode);

  if (!Number.isFinite(accountCount) || accountCount < 0 || accountCount > 5000) {
    return NextResponse.json({ error: "accountCount must be between 0 and 5000" }, { status: 400 });
  }

  return NextResponse.json(createQuote(accountCount, mode));
}
