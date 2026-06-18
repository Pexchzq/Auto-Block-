import { NextResponse } from "next/server";
import { resolveAccountCount, validateAccountInput } from "@/lib/accounts";
import { createQuote } from "@/lib/pricing";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { encryptSecret } from "@/lib/secret-storage";
import { createMockJobId, proxyWorkerJson } from "@/lib/worker-api";
import { getSupabaseAdmin, getUserIdFromRequest, hasSupabaseAdminConfig } from "@/lib/supabase-server";
import type { JobDraftRequest, JobDraftResponse } from "@/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const rateLimit = checkRateLimit(request, { key: "jobs:draft", limit: 30, windowMs: 60_000 });
  if (!rateLimit.ok) {
    const response = rateLimitResponse(rateLimit.retryAfterSeconds);
    return NextResponse.json(response.body, response.init);
  }

  const body = (await request.json().catch(() => ({}))) as Partial<JobDraftRequest>;
  const mode = body.mode === "stable" ? "stable" : "balanced";
  const accountText = String(body.accountText || "");
  const accountCount = resolveAccountCount({ accountCount: body.accountCount, accountText });

  if (accountText.trim()) {
    const validation = validateAccountInput(accountText);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error || "Invalid account input" }, { status: 400 });
    }
  }

  if (!Number.isFinite(accountCount) || accountCount < 2 || accountCount > 5000) {
    return NextResponse.json({ error: "accountCount must be between 2 and 5000" }, { status: 400 });
  }

  if (hasSupabaseAdminConfig()) {
    const admin = getSupabaseAdmin();
    const userId = await getUserIdFromRequest(request);
    if (!admin || !userId) {
      return NextResponse.json({ error: "Login is required before creating a draft" }, { status: 401 });
    }

    const quote = createQuote(accountCount, mode);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const { data, error } = await admin
      .from("jobs")
      .insert({
        user_id: userId,
        status: "draft",
        mode,
        account_count: quote.accountCount,
        directed_pairs: quote.directedPairs,
        price_per_pair_baht: quote.pricePerPair,
        reserved_baht: quote.estimatedCostBaht,
        worker_region: "pending",
        worker_status: "mock",
        note: body.note || "",
        expires_at: expiresAt,
      })
      .select("id")
      .single();

    if (error || !data) {
      return NextResponse.json({ error: error?.message || "Draft create failed" }, { status: 500 });
    }

    if (accountText.trim()) {
      const { error: inputError } = await admin.from("job_inputs").insert({
        job_id: data.id,
        user_id: userId,
        account_text: encryptSecret(accountText),
        status: "stored",
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });
      if (inputError) {
        return NextResponse.json({ error: inputError.message }, { status: 500 });
      }
    }

    return NextResponse.json({
      draftId: data.id,
      quote,
      expiresAt,
    } satisfies JobDraftResponse);
  }

  return NextResponse.json(
    await proxyWorkerJson<JobDraftResponse>("/jobs/draft", {
      method: "POST",
      body: JSON.stringify({
        accountCount,
        mode,
        note: body.note || "",
        accountText,
      }),
    }, () => ({
      draftId: createMockJobId("draft"),
      quote: createQuote(accountCount, mode),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    })),
  );
}
