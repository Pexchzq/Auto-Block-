import { NextResponse } from "next/server";
import { getSupabaseAdmin, getUserIdFromRequest, hasSupabaseAdminConfig } from "@/lib/supabase-server";
import type { JobSummary } from "@/types";

export const runtime = "nodejs";

function toJobSummary(row: Record<string, unknown>): JobSummary {
  const blocked = Number(row.blocked || 0);
  const alreadyBlocked = Number(row.already_blocked || 0);
  const failed = Number(row.failed || 0);
  const completed = blocked + alreadyBlocked + failed;

  return {
    jobId: String(row.id),
    status: row.status as JobSummary["status"],
    accountsUsed: Number(row.account_count || 0),
    directedPairs: Number(row.directed_pairs || 0),
    blocked,
    alreadyBlocked,
    failed,
    successRate: completed > 0 ? Math.round(((blocked + alreadyBlocked) / completed) * 1000) / 10 : 0,
    reservedBaht: Number(row.reserved_baht || 0),
    chargedBaht: Number(row.charged_baht || 0),
    refundedBaht: Number(row.refunded_baht || 0),
    elapsedSeconds: Math.max(0, Math.floor((Date.now() - new Date(String(row.created_at)).getTime()) / 1000)),
    etaSeconds: 0,
    workerRegion: String(row.worker_region || "pending"),
    workerStatus: (row.worker_status || "mock") as JobSummary["workerStatus"],
  };
}

export async function GET(request: Request) {
  if (!hasSupabaseAdminConfig()) {
    return NextResponse.json({ jobs: [] });
  }

  const admin = getSupabaseAdmin();
  const userId = await getUserIdFromRequest(request);
  if (!admin || !userId) {
    return NextResponse.json({ error: "Login is required" }, { status: 401 });
  }

  const { data, error } = await admin
    .from("jobs")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ jobs: (data || []).map((row) => toJobSummary(row as Record<string, unknown>)) });
}
