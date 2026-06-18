import { NextResponse } from "next/server";
import { getSupabaseAdmin, getUserIdFromRequest, hasSupabaseAdminConfig, isAdminUser } from "@/lib/supabase-server";
import type { AdminOverview, JobStatus } from "@/types";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!hasSupabaseAdminConfig()) {
    return NextResponse.json({ error: "Supabase admin env is required" }, { status: 503 });
  }

  const admin = getSupabaseAdmin();
  const userId = await getUserIdFromRequest(request);
  if (!admin || !userId || !(await isAdminUser(userId))) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const [
    profilesResult,
    jobsResult,
    queuedResult,
    runningResult,
    completedResult,
    failedResult,
    ledgerResult,
    latestJobsResult,
  ] = await Promise.all([
    admin.from("profiles").select("id", { count: "exact", head: true }),
    admin.from("jobs").select("id", { count: "exact", head: true }),
    admin.from("jobs").select("id", { count: "exact", head: true }).eq("status", "queued"),
    admin.from("jobs").select("id", { count: "exact", head: true }).eq("status", "running"),
    admin.from("jobs").select("id", { count: "exact", head: true }).eq("status", "completed"),
    admin.from("jobs").select("id", { count: "exact", head: true }).eq("status", "failed"),
    admin.from("wallet_ledger").select("amount_baht,status"),
    admin
      .from("jobs")
      .select("id,status,account_count,directed_pairs,reserved_baht,created_at,profiles(email)")
      .order("created_at", { ascending: false })
      .limit(12),
  ]);

  const queryError = profilesResult.error
    || jobsResult.error
    || queuedResult.error
    || runningResult.error
    || completedResult.error
    || failedResult.error
    || ledgerResult.error
    || latestJobsResult.error;

  if (queryError) {
    return NextResponse.json({ error: queryError.message }, { status: 500 });
  }

  const walletBalanceTotalBaht = (ledgerResult.data || [])
    .filter((row) => row.status === "posted" || row.status === "reserved")
    .reduce((sum, row) => sum + Number(row.amount_baht || 0), 0);

  const latestJobs = (latestJobsResult.data || []).map((row) => {
    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    return {
      jobId: row.id,
      email: profile?.email || null,
      status: row.status as JobStatus,
      accountsUsed: Number(row.account_count || 0),
      directedPairs: Number(row.directed_pairs || 0),
      reservedBaht: Number(row.reserved_baht || 0),
      createdAt: row.created_at,
    };
  });

  return NextResponse.json({
    users: profilesResult.count || 0,
    jobs: jobsResult.count || 0,
    queuedJobs: queuedResult.count || 0,
    runningJobs: runningResult.count || 0,
    completedJobs: completedResult.count || 0,
    failedJobs: failedResult.count || 0,
    walletBalanceTotalBaht,
    latestJobs,
  } satisfies AdminOverview);
}
