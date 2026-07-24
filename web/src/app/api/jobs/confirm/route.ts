import { NextResponse } from "next/server";
import { resolveAccountCount, validateAccountInput } from "@/lib/accounts";
import { createQuote } from "@/lib/pricing";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { createMockJobId, proxyWorkerJson } from "@/lib/worker-api";
import { confirmJobForUser, JobServiceError } from "@/lib/job-service";
import { getSupabaseAdmin, getUserIdFromRequest, hasSupabaseAdminConfig } from "@/lib/supabase-server";
import type { BlockMeshMode, JobSummary } from "@/types";

export const runtime = "nodejs";

type ConfirmBody = {
  accountCount?: number;
  mode?: BlockMeshMode;
  draftId?: string;
  accountText?: string;
};

function localWorkerEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.BLOCKMESH_LOCAL_WORKER === "1";
}

export async function POST(request: Request) {
  const rateLimit = checkRateLimit(request, { key: "jobs:confirm", limit: 20, windowMs: 60_000 });
  if (!rateLimit.ok) {
    const response = rateLimitResponse(rateLimit.retryAfterSeconds);
    return NextResponse.json(response.body, response.init);
  }

  const body = (await request.json().catch(() => ({}))) as ConfirmBody;
  const mode: BlockMeshMode = body.mode === "stable" ? "stable" : "balanced";
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
      return NextResponse.json({ error: "Login is required before confirming a job" }, { status: 401 });
    }

    try {
      const job = await confirmJobForUser({
        admin,
        userId,
        accountCount,
        mode,
        draftId: body.draftId || null,
        accountText,
        source: "web",
        runLocalJob: localWorkerEnabled()
          ? async (localJob) => {
              const { runLocalBlockMeshJob } = await import("@/lib/local-blockmesh-worker");
              await runLocalBlockMeshJob(localJob);
            }
          : undefined,
      });
      return NextResponse.json({ job } satisfies { job: JobSummary });
    } catch (error) {
      if (error instanceof JobServiceError) {
        return NextResponse.json({ error: error.message, ...(error.details || {}) }, { status: error.status });
      }
      return NextResponse.json({ error: error instanceof Error ? error.message : "Job confirmation failed" }, { status: 500 });
    }
  }

  return NextResponse.json(
    await proxyWorkerJson<{ job: JobSummary }>("/jobs/confirm", {
      method: "POST",
      body: JSON.stringify({
        draftId: body.draftId || null,
        accountCount,
        mode,
        accountText,
      }),
    }, () => {
      const quote = createQuote(accountCount, mode);
      return {
        job: {
          jobId: createMockJobId("bm"),
          status: "queued",
          accountsUsed: quote.accountCount,
          directedPairs: quote.directedPairs,
          blocked: 0,
          alreadyBlocked: 0,
          failed: 0,
          successRate: 0,
          reservedBaht: quote.estimatedCostBaht,
          chargedBaht: 0,
          refundedBaht: 0,
          elapsedSeconds: 0,
          etaSeconds: Math.round(quote.estimatedDurationMinutes * 60),
          workerRegion: "mock-sin1",
          workerStatus: "mock",
        },
      };
    }),
  );
}
