import { NextResponse } from "next/server";
import { getSupabaseAdmin, getUserIdFromRequest, hasSupabaseAdminConfig, isAdminUser } from "@/lib/supabase-server";
import type { AdminAuditLogRow } from "@/types";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!hasSupabaseAdminConfig()) {
    return NextResponse.json({ error: "Supabase admin env is required" }, { status: 503 });
  }

  const admin = getSupabaseAdmin();
  const actorUserId = await getUserIdFromRequest(request);
  if (!admin || !actorUserId || !(await isAdminUser(actorUserId))) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const { data, error } = await admin
    .from("audit_logs")
    .select("id,actor_user_id,action,target_type,target_id,metadata,created_at,profiles(email)")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const logs: AdminAuditLogRow[] = (data || []).map((row) => {
    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    return {
      id: row.id,
      actorEmail: profile?.email || null,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      metadata: row.metadata || {},
      createdAt: row.created_at,
    };
  });

  return NextResponse.json({ logs });
}
