import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getSupabaseAdmin, getUserIdFromRequest, hasSupabaseAdminConfig, isAdminUser } from "@/lib/supabase-server";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ userId: string }> }) {
  if (!hasSupabaseAdminConfig()) {
    return NextResponse.json({ error: "Supabase admin env is required" }, { status: 503 });
  }

  const admin = getSupabaseAdmin();
  const actorUserId = await getUserIdFromRequest(request);
  if (!admin || !actorUserId || !(await isAdminUser(actorUserId))) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const { userId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as { amountBaht?: number; reason?: string };
  const amountBaht = Math.round(Number(body.amountBaht || 0) * 100) / 100;
  const reason = String(body.reason || "Manual admin adjustment").slice(0, 180);

  if (!Number.isFinite(amountBaht) || amountBaht === 0 || Math.abs(amountBaht) > 1000000) {
    return NextResponse.json({ error: "amountBaht must be non-zero and within allowed range" }, { status: 400 });
  }

  const { data: target, error: targetError } = await admin
    .from("profiles")
    .select("id,email")
    .eq("id", userId)
    .single();

  if (targetError || !target) {
    return NextResponse.json({ error: targetError?.message || "User not found" }, { status: 404 });
  }

  const reference = `manual:${randomUUID()}`;
  const { error: ledgerError } = await admin.from("wallet_ledger").insert({
    user_id: userId,
    type: "manual_adjust",
    amount_baht: amountBaht,
    label: reason,
    provider: "admin",
    reference,
    status: "posted",
    metadata: { actorUserId },
  });

  if (ledgerError) {
    return NextResponse.json({ error: ledgerError.message }, { status: 500 });
  }

  const { error: auditError } = await admin.from("audit_logs").insert({
    actor_user_id: actorUserId,
    action: "admin_adjust_wallet",
    target_type: "user",
    target_id: userId,
    metadata: { amountBaht, reason, email: target.email },
  });
  if (auditError) {
    return NextResponse.json({ error: auditError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, amountBaht, reference });
}
