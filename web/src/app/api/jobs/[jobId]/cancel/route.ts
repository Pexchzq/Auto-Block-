import { NextResponse } from "next/server";
import { getSupabaseAdmin, getUserIdFromRequest, hasSupabaseAdminConfig } from "@/lib/supabase-server";
import { proxyWorkerJson } from "@/lib/worker-api";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await context.params;

  if (hasSupabaseAdminConfig()) {
    const admin = getSupabaseAdmin();
    const userId = await getUserIdFromRequest(request);
    if (!admin || !userId) {
      return NextResponse.json({ error: "Login is required" }, { status: 401 });
    }

    const { data: job, error: jobError } = await admin
      .from("jobs")
      .select("id,status,reserved_baht,charged_baht,user_id")
      .eq("id", jobId)
      .eq("user_id", userId)
      .single();

    if (jobError || !job) {
      return NextResponse.json({ error: jobError?.message || "Job not found" }, { status: 404 });
    }

    if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
      return NextResponse.json({ ok: true, status: job.status });
    }

    const reserved = Number(job.reserved_baht || 0);
    const charged = Number(job.charged_baht || 0);
    const refund = Math.max(0, Math.round((reserved - charged) * 100) / 100);

    if (refund > 0) {
      const { error: refundError } = await admin.from("wallet_ledger").upsert({
        user_id: userId,
        job_id: jobId,
        type: "refund",
        amount_baht: refund,
        label: `Refund cancelled job ${jobId}`,
        provider: "wallet",
        reference: `${jobId}:cancel-refund`,
        status: "posted",
      }, { onConflict: "provider,reference", ignoreDuplicates: true });
      if (refundError) {
        return NextResponse.json({ error: refundError.message }, { status: 500 });
      }
    }

    const { error: updateError } = await admin
      .from("jobs")
      .update({
        status: "cancelled",
        worker_status: "failed",
        refunded_baht: refund,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId)
      .eq("user_id", userId);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    const { error: auditError } = await admin.from("audit_logs").insert({
      actor_user_id: userId,
      action: "user_cancel_job",
      target_type: "job",
      target_id: jobId,
      metadata: { refundedBaht: refund },
    });
    if (auditError) {
      return NextResponse.json({ error: auditError.message }, { status: 500 });
    }

    await proxyWorkerJson(`/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" }, () => ({ ok: true }));
    return NextResponse.json({ ok: true, status: "cancelled", refundedBaht: refund });
  }

  return NextResponse.json(
    await proxyWorkerJson(`/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" }, () => ({ ok: true, status: "cancelled" })),
  );
}
