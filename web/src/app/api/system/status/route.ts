import { NextResponse } from "next/server";
import { paymentProviderMode, placeholderTopUpAllowed } from "@/lib/payment-mode";
import { maxActiveJobsPerUser } from "@/lib/pricing";
import { getSupabaseAdmin, getUserIdFromRequest, hasSupabaseAdminConfig, isAdminUser } from "@/lib/supabase-server";
import { hasWorkerApi } from "@/lib/worker-api";

export const runtime = "nodejs";

async function workerHealth() {
  if (!process.env.WORKER_API_BASE) {
    return { configured: false, ok: false, detail: "WORKER_API_BASE is not set" };
  }

  try {
    const response = await fetch(new URL("/health", process.env.WORKER_API_BASE), { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    return {
      configured: true,
      ok: response.ok && data.ok === true,
      detail: response.ok ? data : { status: response.status },
    };
  } catch (error) {
    return {
      configured: true,
      ok: false,
      detail: error instanceof Error ? error.message : "Worker health check failed",
    };
  }
}

export async function GET(request: Request) {
  const admin = getSupabaseAdmin();
  const userId = await getUserIdFromRequest(request);
  const adminAllowed = Boolean(admin && userId && await isAdminUser(userId));

  if (hasSupabaseAdminConfig() && !adminAllowed) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const supabase = {
    configured: hasSupabaseAdminConfig(),
    ok: false,
    detail: "not configured",
  };

  if (admin) {
    const { error } = await admin.from("profiles").select("id", { count: "exact", head: true });
    supabase.ok = !error;
    supabase.detail = error?.message || "connected";
  }

  const encryptionKey = process.env.JOB_INPUT_ENCRYPTION_KEY || "";
  const activeJobLimit = maxActiveJobsPerUser();

  return NextResponse.json({
    appEnv: process.env.NEXT_PUBLIC_APP_ENV || "development",
    siteUrlConfigured: Boolean(process.env.NEXT_PUBLIC_SITE_URL),
    supabase,
    worker: await workerHealth(),
    workerDispatchConfigured: hasWorkerApi() && Boolean(process.env.WORKER_API_TOKEN),
    encryption: {
      configured: Boolean(encryptionKey),
      ok: encryptionKey.length >= 32,
    },
    quota: {
      maxActiveJobsPerUser: activeJobLimit,
      ok: activeJobLimit > 0,
    },
    payment: {
      mode: paymentProviderMode(),
      liveTrueMoneyEnabled: false,
      placeholderTopUpEnabled: placeholderTopUpAllowed(),
    },
    secretsPolicy: "configuration secrets are not returned by this endpoint",
  });
}
