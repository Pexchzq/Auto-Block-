import { NextResponse } from "next/server";
import { proxyWorkerJson } from "@/lib/worker-api";
import { getSupabaseAdmin, getUserIdFromRequest, hasSupabaseAdminConfig } from "@/lib/supabase-server";
import type { JobSummary } from "@/types";

export const runtime = "nodejs";

function mockJob(jobId: string): { job: JobSummary } {
  const directedPairs = 6320;
  const elapsedSeconds = Math.floor((Date.now() / 1000) % 900);
  const progress = Math.min(0.92, elapsedSeconds / 900);
  const blocked = Math.floor(directedPairs * progress * 0.81);
  const alreadyBlocked = Math.floor(directedPairs * progress * 0.16);
  const failed = Math.floor(directedPairs * progress * 0.03);
  const done = blocked + alreadyBlocked + failed;
  const reservedBaht = 63.2;
  const chargedBaht = Math.round(((blocked + alreadyBlocked) * 0.01) * 100) / 100;
  const refundedBaht = Math.round((failed * 0.01) * 100) / 100;

  return {
    job: {
      jobId,
      status: progress > 0.9 ? "retrying" : "running",
      accountsUsed: 80,
      directedPairs,
      blocked,
      alreadyBlocked,
      failed,
      successRate: done > 0 ? Math.round(((blocked + alreadyBlocked) / done) * 1000) / 10 : 0,
      reservedBaht,
      chargedBaht,
      refundedBaht,
      elapsedSeconds,
      etaSeconds: Math.max(0, 900 - elapsedSeconds),
      workerRegion: "mock-sin1",
      workerStatus: "mock",
    },
  };
}

export async function GET(_: Request, context: { params: Promise<{ jobId: string }> }) {
  const params = await context.params;
  const jobId = decodeURIComponent(params.jobId);

  if (hasSupabaseAdminConfig()) {
    const request = _; 
    const admin = getSupabaseAdmin();
    const userId = await getUserIdFromRequest(request);
    if (!admin || !userId) {
      return NextResponse.json({ error: "Login is required" }, { status: 401 });
    }

    const { data, error } = await admin
      .from("jobs")
      .select("*")
      .eq("id", jobId)
      .eq("user_id", userId)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: error?.message || "Job not found" }, { status: 404 });
    }

    const completed = Number(data.blocked || 0) + Number(data.already_blocked || 0) + Number(data.failed || 0);
    return NextResponse.json({
      job: {
        jobId: data.id,
        status: data.status,
        accountsUsed: Number(data.account_count),
        directedPairs: Number(data.directed_pairs),
        blocked: Number(data.blocked || 0),
        alreadyBlocked: Number(data.already_blocked || 0),
        failed: Number(data.failed || 0),
        successRate: completed > 0 ? Math.round(((Number(data.blocked || 0) + Number(data.already_blocked || 0)) / completed) * 1000) / 10 : 0,
        reservedBaht: Number(data.reserved_baht || 0),
        chargedBaht: Number(data.charged_baht || 0),
        refundedBaht: Number(data.refunded_baht || 0),
        elapsedSeconds: Math.max(0, Math.floor((Date.now() - new Date(data.created_at).getTime()) / 1000)),
        etaSeconds: 0,
        workerRegion: data.worker_region || "pending",
        workerStatus: data.worker_status || "mock",
      } satisfies JobSummary,
    });
  }

  return NextResponse.json(
    await proxyWorkerJson<{ job: JobSummary }>(`/jobs/${encodeURIComponent(jobId)}`, {
      method: "GET",
    }, () => mockJob(jobId)),
  );
}
