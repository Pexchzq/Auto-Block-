import { NextResponse } from "next/server";
import { getSupabaseAdmin, getUserIdFromRequest, hasSupabaseAdminConfig, isAdminUser } from "@/lib/supabase-server";
import { proxyWorkerJson } from "@/lib/worker-api";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ jobId: string }> }) {
  if (!hasSupabaseAdminConfig()) {
    return NextResponse.json({ error: "Supabase admin env is required" }, { status: 503 });
  }

  const admin = getSupabaseAdmin();
  const actorUserId = await getUserIdFromRequest(request);
  if (!admin || !actorUserId || !(await isAdminUser(actorUserId))) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const { jobId } = await context.params;
  const { data: job, error: jobError } = await admin
    .from("jobs")
    .select("id,status,user_id,reserved_baht,charged_baht")
    .eq("id", jobId)
    .single();

  if (jobError || !job) {
    return NextResponse.json({ error: jobError?.message || "Job not found" }, { status: 404 });
  }

  if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
    return NextResponse.json({ ok: true, status: job.status });
  }

  const refund = Math.max(0, Math.round((Number(job.reserved_baht || 0) - Number(job.charged_baht || 0)) * 100) / 100);
  const now = new Date().toISOString();

  if (refund > 0) {
    const { error: refundError } = await admin.from("wallet_ledger").upsert({
      user_id: job.user_id,
      job_id: jobId,
      type: "refund",
      amount_baht: refund,
      label: `Admin refund cancelled job ${jobId}`,
      provider: "wallet",
      reference: `${jobId}:admin-cancel-refund`,
      status: "posted",
    }, { onConflict: "provider,reference", ignoreDuplicates: true });
    if (refundError) return NextResponse.json({ error: refundError.message }, { status: 500 });
  }

  const { error: updateError } = await admin
    .from("jobs")
    .update({
      status: "cancelled",
      worker_status: "failed",
      refunded_baht: refund,
      updated_at: now,
    })
    .eq("id", jobId);

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  const { error: auditError } = await admin.from("audit_logs").insert({
    actor_user_id: actorUserId,
    action: "admin_cancel_job",
    target_type: "job",
    target_id: jobId,
    metadata: { refundedBaht: refund },
  });
  if (auditError) return NextResponse.json({ error: auditError.message }, { status: 500 });

  await proxyWorkerJson(`/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" }, () => ({ ok: true }));
  return NextResponse.json({ ok: true, status: "cancelled", refundedBaht: refund });
}
