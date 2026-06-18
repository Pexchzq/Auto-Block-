import { NextResponse } from "next/server";
import { getSupabaseAdmin, hasSupabaseAdminConfig } from "@/lib/supabase-server";
import { verifyWorkerToken } from "@/lib/worker-api";

export const runtime = "nodejs";

type WorkerStatusBody = {
  status?: "queued" | "running" | "retrying" | "completed" | "failed" | "cancelled";
  workerRegion?: string;
  blocked?: number;
  alreadyBlocked?: number;
  already_blocked?: number;
  failed?: number;
};

function safeInteger(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue >= 0 ? Math.floor(numberValue) : undefined;
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
  const body = (await request.json().catch(() => ({}))) as WorkerStatusBody;
  const patch: Record<string, unknown> = {
    worker_status: body.status === "failed" ? "failed" : "connected",
    updated_at: new Date().toISOString(),
  };

  if (body.status) patch.status = body.status;
  if (body.workerRegion) patch.worker_region = body.workerRegion;

  const blocked = safeInteger(body.blocked);
  const alreadyBlocked = safeInteger(body.alreadyBlocked ?? body.already_blocked);
  const failed = safeInteger(body.failed);
  if (blocked !== undefined) patch.blocked = blocked;
  if (alreadyBlocked !== undefined) patch.already_blocked = alreadyBlocked;
  if (failed !== undefined) patch.failed = failed;

  const { error } = await admin.from("jobs").update(patch).eq("id", jobId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
