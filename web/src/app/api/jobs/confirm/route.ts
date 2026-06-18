import { NextResponse } from "next/server";
import { resolveAccountCount, validateAccountInput } from "@/lib/accounts";
import { createQuote, maxActiveJobsPerUser } from "@/lib/pricing";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { decryptSecret, encryptSecret } from "@/lib/secret-storage";
import { createMockJobId, dispatchWorkerJob, hasWorkerApi, proxyWorkerJson } from "@/lib/worker-api";
import { getSupabaseAdmin, getUserIdFromRequest, getWalletBalanceBaht, hasSupabaseAdminConfig } from "@/lib/supabase-server";
import type { JobSummary } from "@/types";

export const runtime = "nodejs";

function localWorkerEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.BLOCKMESH_LOCAL_WORKER === "1";
}

export async function POST(request: Request) {
  const rateLimit = checkRateLimit(request, { key: "jobs:confirm", limit: 20, windowMs: 60_000 });
  if (!rateLimit.ok) {
    const response = rateLimitResponse(rateLimit.retryAfterSeconds);
    return NextResponse.json(response.body, response.init);
  }

  const body = (await request.json().catch(() => ({}))) as {
    accountCount?: number;
    mode?: "balanced" | "stable";
    draftId?: string;
    accountText?: string;
  };
  let mode: "balanced" | "stable" = body.mode === "stable" ? "stable" : "balanced";
  let accountText = String(body.accountText || "");
  let accountCount = resolveAccountCount({ accountCount: body.accountCount, accountText });

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

    const draftId = body.draftId || null;
    let jobId = draftId;
    let quote = createQuote(accountCount, mode);
    const activeLimit = maxActiveJobsPerUser();

    const { count: activeJobsCount, error: activeJobsError } = await admin
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .in("status", ["queued", "running", "retrying"]);
    if (activeJobsError) {
      return NextResponse.json({ error: activeJobsError.message }, { status: 500 });
    }
    if ((activeJobsCount || 0) >= activeLimit) {
      return NextResponse.json({ error: `Active job limit reached (${activeLimit}). Wait for an existing job to finish or cancel it first.` }, { status: 429 });
    }

    if (draftId) {
      const { data: existingDraft, error: draftReadError } = await admin
        .from("jobs")
        .select("account_count,mode,status")
        .eq("id", draftId)
        .eq("user_id", userId)
        .single();
      if (draftReadError || !existingDraft) {
        return NextResponse.json({ error: draftReadError?.message || "Draft not found" }, { status: 404 });
      }
      if (existingDraft.status !== "draft") {
        return NextResponse.json({ error: "Only draft jobs can be confirmed" }, { status: 409 });
      }
      mode = existingDraft.mode === "stable" ? "stable" : "balanced";
      accountCount = Number(existingDraft.account_count || accountCount);
      quote = createQuote(accountCount, mode);

      if (accountText.trim()) {
        await admin.from("job_inputs").upsert({
          job_id: draftId,
          user_id: userId,
          account_text: encryptSecret(accountText),
          status: "stored",
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        }, { onConflict: "job_id" });
      }
    } else {
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
          worker_status: "queued",
        })
        .select("id")
        .single();
      if (error || !data) return NextResponse.json({ error: error?.message || "Job create failed" }, { status: 500 });
      jobId = data.id;

      if (accountText.trim()) {
        const { error: inputError } = await admin.from("job_inputs").insert({
          job_id: jobId,
          user_id: userId,
          account_text: encryptSecret(accountText),
          status: "stored",
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        });
        if (inputError) return NextResponse.json({ error: inputError.message }, { status: 500 });
      }
    }

    if (!accountText.trim() && jobId) {
      const { data: storedInput } = await admin
        .from("job_inputs")
        .select("account_text")
        .eq("job_id", jobId)
        .eq("user_id", userId)
        .maybeSingle();
      accountText = decryptSecret(storedInput?.account_text || "");
    }

    if (accountText.trim()) {
      const validation = validateAccountInput(accountText);
      if (!validation.ok) {
        return NextResponse.json({ error: validation.error || "Invalid stored account input" }, { status: 400 });
      }
    }

    accountCount = resolveAccountCount({ accountCount, accountText });
    const verifiedQuote = createQuote(accountCount, mode);
    if (verifiedQuote.accountCount !== quote.accountCount || verifiedQuote.directedPairs !== quote.directedPairs) {
      return NextResponse.json({ error: "Account count changed after quote. Recreate the draft before confirming." }, { status: 409 });
    }
    quote = verifiedQuote;

    if (!jobId) {
      return NextResponse.json({ error: "Job id is missing" }, { status: 500 });
    }

    if (!hasWorkerApi() && !localWorkerEnabled()) {
      return NextResponse.json({ error: "Worker is not configured. Set WORKER_API_BASE before confirming jobs." }, { status: 503 });
    }

    const balance = await getWalletBalanceBaht(userId);
    if (balance < quote.estimatedCostBaht) {
      return NextResponse.json({ error: "Wallet balance is not enough for this job" }, { status: 402 });
    }

    const { error: ledgerError } = await admin.from("wallet_ledger").upsert({
      user_id: userId,
      job_id: jobId,
      type: "reserve",
      amount_baht: -quote.estimatedCostBaht,
      label: `Reserved for ${jobId}`,
      provider: "wallet",
      reference: jobId,
      status: "reserved",
    }, { onConflict: "provider,reference", ignoreDuplicates: true });
    if (ledgerError) return NextResponse.json({ error: ledgerError.message }, { status: 500 });

    const { error: queueError } = await admin
      .from("jobs")
      .update({
        status: "queued",
        reserved_baht: quote.estimatedCostBaht,
        worker_status: "queued",
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId)
      .eq("user_id", userId);

    if (queueError) {
      const { error: queueRefundError } = await admin.from("wallet_ledger").upsert({
        user_id: userId,
        job_id: jobId,
        type: "refund",
        amount_baht: quote.estimatedCostBaht,
        label: `Refund failed queue transition for ${jobId}`,
        provider: "wallet",
        reference: `${jobId}:queue-refund`,
        status: "posted",
      }, { onConflict: "provider,reference", ignoreDuplicates: true });
      if (queueRefundError) {
        return NextResponse.json({ error: queueRefundError.message }, { status: 500 });
      }
      return NextResponse.json({ error: queueError.message }, { status: 500 });
    }

    if (hasWorkerApi()) {
      const dispatch = await dispatchWorkerJob({
        jobId: jobId as string,
        userId,
        mode,
        accountCount: quote.accountCount,
        directedPairs: quote.directedPairs,
        pricePerPairBaht: quote.pricePerPair,
        accountText,
        callbackBaseUrl: process.env.NEXT_PUBLIC_SITE_URL,
      });

      const { error: dispatchStatusError } = await admin.from("jobs").update({
        worker_region: dispatch.queued ? "external-worker" : "external-worker-error",
        worker_status: dispatch.queued ? "connected" : "failed",
        status: dispatch.queued ? "queued" : "failed",
        updated_at: new Date().toISOString(),
      }).eq("id", jobId);
      if (dispatchStatusError) {
        return NextResponse.json({ error: dispatchStatusError.message }, { status: 500 });
      }

      if (!dispatch.queued) {
        const { error: dispatchRefundError } = await admin.from("wallet_ledger").upsert({
          user_id: userId,
          job_id: jobId,
          type: "refund",
          amount_baht: quote.estimatedCostBaht,
          label: `Refund failed worker dispatch for ${jobId}`,
          provider: "wallet",
          reference: `${jobId}:dispatch-refund`,
          status: "posted",
        }, { onConflict: "provider,reference", ignoreDuplicates: true });
        if (dispatchRefundError) {
          return NextResponse.json({ error: dispatchRefundError.message }, { status: 500 });
        }

        const { error: failedJobUpdateError } = await admin.from("jobs").update({
          failed: quote.directedPairs,
          refunded_baht: quote.estimatedCostBaht,
          updated_at: new Date().toISOString(),
        }).eq("id", jobId);
        if (failedJobUpdateError) {
          return NextResponse.json({ error: failedJobUpdateError.message }, { status: 500 });
        }

        const { error: dispatchReportError } = await admin.from("job_reports").insert({
          job_id: jobId,
          user_id: userId,
          report_json: {
            jobId,
            source: "external-worker-dispatch",
            failed: true,
            error: dispatch.error || "Worker did not accept the job",
            secretsPolicy: "cookies/passwords/tokens are never included in reports",
          },
        });
        if (dispatchReportError) {
          return NextResponse.json({ error: dispatchReportError.message }, { status: 500 });
        }

        return NextResponse.json({
          error: dispatch.error || "Worker did not accept the job",
          job: {
            jobId: jobId as string,
            status: "failed",
            accountsUsed: quote.accountCount,
            directedPairs: quote.directedPairs,
            blocked: 0,
            alreadyBlocked: 0,
            failed: quote.directedPairs,
            successRate: 0,
            reservedBaht: quote.estimatedCostBaht,
            chargedBaht: 0,
            refundedBaht: quote.estimatedCostBaht,
            elapsedSeconds: 0,
            etaSeconds: 0,
            workerRegion: "external-worker-error",
            workerStatus: "failed",
          },
        } satisfies { error: string; job: JobSummary }, { status: 502 });
      }
    } else if (localWorkerEnabled()) {
      const { runLocalBlockMeshJob } = await import("@/lib/local-blockmesh-worker");
      void runLocalBlockMeshJob({
        jobId: jobId as string,
        userId,
        mode,
        pricePerPairBaht: quote.pricePerPair,
      });
    }

    return NextResponse.json({
      job: {
        jobId: jobId as string,
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
        workerRegion: "pending",
        workerStatus: hasWorkerApi() || localWorkerEnabled() ? "queued" : "queued",
      },
    } satisfies { job: JobSummary });
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
      const jobId = createMockJobId("bm");
      return {
        job: {
          jobId,
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
