import { NextResponse } from "next/server";
import { getSupabaseAdmin, getUserIdFromRequest, hasSupabaseAdminConfig, isAdminUser } from "@/lib/supabase-server";
import type { AdminUserRow } from "@/types";

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

  const [{ data: profiles, error: profilesError }, { data: ledger, error: ledgerError }, { data: jobs, error: jobsError }] = await Promise.all([
    admin.from("profiles").select("id,email,role,created_at").order("created_at", { ascending: false }).limit(100),
    admin.from("wallet_ledger").select("user_id,amount_baht,status"),
    admin.from("jobs").select("user_id,id"),
  ]);

  if (profilesError || ledgerError || jobsError) {
    return NextResponse.json({ error: profilesError?.message || ledgerError?.message || jobsError?.message }, { status: 500 });
  }

  const balanceByUser = new Map<string, number>();
  for (const row of ledger || []) {
    if (row.status !== "posted" && row.status !== "reserved") continue;
    balanceByUser.set(row.user_id, (balanceByUser.get(row.user_id) || 0) + Number(row.amount_baht || 0));
  }

  const jobsByUser = new Map<string, number>();
  for (const row of jobs || []) {
    jobsByUser.set(row.user_id, (jobsByUser.get(row.user_id) || 0) + 1);
  }

  const users: AdminUserRow[] = (profiles || []).map((profile) => ({
    userId: profile.id,
    email: profile.email,
    role: profile.role,
    balanceBaht: Math.round((balanceByUser.get(profile.id) || 0) * 100) / 100,
    jobs: jobsByUser.get(profile.id) || 0,
    createdAt: profile.created_at,
  }));

  return NextResponse.json({ users });
}
