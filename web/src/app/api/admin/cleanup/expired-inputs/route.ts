import { NextResponse } from "next/server";
import { getSupabaseAdmin, getUserIdFromRequest, hasSupabaseAdminConfig, isAdminUser } from "@/lib/supabase-server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!hasSupabaseAdminConfig()) {
    return NextResponse.json({ error: "Supabase admin env is required" }, { status: 503 });
  }

  const admin = getSupabaseAdmin();
  const actorUserId = await getUserIdFromRequest(request);
  if (!admin || !actorUserId || !(await isAdminUser(actorUserId))) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const now = new Date().toISOString();
  const { data: expiredRows, error: selectError } = await admin
    .from("job_inputs")
    .select("job_id")
    .neq("status", "deleted")
    .lt("expires_at", now);

  if (selectError) {
    return NextResponse.json({ error: selectError.message }, { status: 500 });
  }

  const expiredJobIds = (expiredRows || []).map((row) => row.job_id);
  if (expiredJobIds.length === 0) {
    return NextResponse.json({ ok: true, cleaned: 0 });
  }

  const { error: updateError } = await admin
    .from("job_inputs")
    .update({
      account_text: "",
      status: "deleted",
    })
    .in("job_id", expiredJobIds);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  const { error: auditError } = await admin.from("audit_logs").insert({
    actor_user_id: actorUserId,
    action: "admin_cleanup_expired_job_inputs",
    target_type: "job_inputs",
    target_id: null,
    metadata: { cleaned: expiredJobIds.length },
  });
  if (auditError) {
    return NextResponse.json({ error: auditError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, cleaned: expiredJobIds.length });
}
