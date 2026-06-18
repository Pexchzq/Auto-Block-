import { NextResponse } from "next/server";
import { roundBaht } from "@/lib/pricing";
import { sanitizeReportValue } from "@/lib/report-sanitizer";
import { getSupabaseAdmin, hasSupabaseAdminConfig } from "@/lib/supabase-server";
import { verifyWorkerToken } from "@/lib/worker-api";

export const runtime = "nodejs";

type WorkerCompleteBody = {
  status?: "completed" | "failed" | "cancelled";
  blocked?: number;
  alreadyBlocked?: number;
  already_blocked?: number;
  failed?: number;
  report?: Record<string, unknown>;
  error?: string;
};

function safeInteger(value: unknown): number {
  const numberValue = Number(value || 0);
  return Number.isFinite(numberValue) && numberValue > 0 ? Math.floor(numberValue) : 0;
}

export async function POST(request: Request, context: { params: Promise<{ jobId: string }> }) {
  if (!hasSupabaseAdminConfig()) {
    return NextResponse.json({ error: "Supabase admin env is required" }, { status: 503 });
  }

  if (!verifyWorkerToken(request)) {
    return NextResponse.json({ error: "Worker token is invalid" }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "Supabase admin client unavailable" }, { status: 503 });

  const { jobId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as WorkerCompleteBody;

  const { data: job, error: jobError } = await admin
    .from("jobs")
    .select("*")
    .eq("id", jobId)
    .single();

  if (jobError || !job) {
    return NextResponse.json({ error: jobError?.message || "Job not found" }, { status: 404 });
  }

  if (["completed", "failed", "cancelled"].includes(String(job.status))) {
    return NextResponse.json({
      ok: true,
      alreadyFinal: true,
      status: job.status,
      message: "Job is already finalized; duplicate worker completion ignored",
    });
  }

  const blocked = safeInteger(body.blocked);
  const alreadyBlocked = safeInteger(body.alreadyBlocked ?? body.already_blocked);
  const failed = safeInteger(body.failed);
  const pricePerPair = Number(job.price_per_pair_baht || 0);
  const chargedBaht = roundBaht((blocked + alreadyBlocked) * pricePerPair);
  const refundedBaht = roundBaht(failed * pricePerPair);
  const finalStatus = body.status === "failed" || body.status === "cancelled" ? body.status : "completed";
  const now = new Date().toISOString();

  const workerReport = sanitizeReportValue(body.report || {}) as Record<string, unknown>;
  const report = {
    ...workerReport,
    jobId,
    generatedAt: now,
    accountsUsed: Number(job.account_count || 0),
    directedPairs: Number(job.directed_pairs || 0),
    blocked,
    alreadyBlocked,
    failed,
    successRate: blocked + alreadyBlocked + failed > 0
      ? Math.round(((blocked + alreadyBlocked) / (blocked + alreadyBlocked + failed)) * 1000) / 10
      : 0,
    reservedBaht: Number(job.reserved_baht || 0),
    chargedBaht,
    refundedBaht,
    error: body.error,
    source: "external-worker",
    secretsPolicy: "cookies/passwords/tokens are never included in reports",
  };

  const { error: reportError } = await admin.from("job_reports").insert({
    job_id: jobId,
    user_id: job.user_id,
    report_json: report,
  });
  if (reportError) {
    return NextResponse.json({ error: reportError.message }, { status: 500 });
  }

  const { error: captureError } = await admin.from("wallet_ledger").upsert({
    user_id: job.user_id,
    job_id: jobId,
    type: "capture",
    amount_baht: 0,
    label: `Captured ${chargedBaht.toFixed(2)} THB for completed pairs in ${jobId}`,
    provider: "wallet",
    reference: `${jobId}:capture`,
    status: "posted",
    metadata: {
      capturedBaht: chargedBaht,
      blocked,
      alreadyBlocked,
      failed,
    },
  }, { onConflict: "provider,reference", ignoreDuplicates: true });
  if (captureError) {
    return NextResponse.json({ error: captureError.message }, { status: 500 });
  }

  if (refundedBaht > 0) {
    const { error: refundError } = await admin.from("wallet_ledger").upsert({
      user_id: job.user_id,
      job_id: jobId,
      type: "refund",
      amount_baht: refundedBaht,
      label: `Refund failed pairs for ${jobId}`,
      provider: "wallet",
      reference: `${jobId}:refund`,
      status: "posted",
    }, { onConflict: "provider,reference", ignoreDuplicates: true });
    if (refundError) {
      return NextResponse.json({ error: refundError.message }, { status: 500 });
    }
  }

  const { error: updateError } = await admin
    .from("jobs")
    .update({
      status: finalStatus,
      worker_status: finalStatus === "failed" ? "failed" : "connected",
      blocked,
      already_blocked: alreadyBlocked,
      failed,
      charged_baht: chargedBaht,
      refunded_baht: refundedBaht,
      updated_at: now,
    })
    .eq("id", jobId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  await admin.from("job_inputs").update({
    status: "deleted",
    account_text: "",
  }).eq("job_id", jobId);

  return NextResponse.json({ ok: true, report });
}
