import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveAccountCount, validateAccountInput } from "@/lib/accounts";
import { createQuote, maxActiveJobsPerUser } from "@/lib/pricing";
import { decryptSecret, encryptSecret } from "@/lib/secret-storage";
import { dispatchWorkerJob, hasWorkerApi } from "@/lib/worker-api";
import { getWalletBalanceBaht } from "@/lib/supabase-server";
import type { BlockMeshMode, JobSummary } from "@/types";

export type JobSource = "web" | "discord";

export class JobServiceError extends Error {
  status: number;
  details?: Record<string, unknown>;

  constructor(status: number, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "JobServiceError";
    this.status = status;
    this.details = details;
  }
}

type ConfirmJobInput = {
  admin: SupabaseClient;
  userId: string;
  accountCount?: number;
  mode?: BlockMeshMode;
  draftId?: string | null;
  accountText?: string;
  source?: JobSource;
  note?: string;
  freeMode?: boolean;
  runLocalJob?: (input: {
    jobId: string;
    userId: string;
    mode: BlockMeshMode;
    pricePerPairBaht: number;
  }) => void | Promise<void>;
};

function summary(input: {
  jobId: string;
  status: JobSummary["status"];
  accountCount: number;
  directedPairs: number;
  blocked?: number;
  alreadyBlocked?: number;
  failed?: number;
  reservedBaht?: number;
  chargedBaht?: number;
  refundedBaht?: number;
  etaSeconds?: number;
  workerRegion?: string;
  workerStatus?: JobSummary["workerStatus"];
  createdAt?: string;
}): JobSummary {
  const blocked = Number(input.blocked || 0);
  const alreadyBlocked = Number(input.alreadyBlocked || 0);
  const failed = Number(input.failed || 0);
  const done = blocked + alreadyBlocked + failed;
  return {
    jobId: input.jobId,
    status: input.status,
    accountsUsed: input.accountCount,
    directedPairs: input.directedPairs,
    blocked,
    alreadyBlocked,
    failed,
    successRate: done > 0 ? Math.round(((blocked + alreadyBlocked) / done) * 1000) / 10 : 0,
    reservedBaht: Number(input.reservedBaht || 0),
    chargedBaht: Number(input.chargedBaht || 0),
    refundedBaht: Number(input.refundedBaht || 0),
    elapsedSeconds: input.createdAt
      ? Math.max(0, Math.floor((Date.now() - new Date(input.createdAt).getTime()) / 1000))
      : 0,
    etaSeconds: Math.max(0, Math.floor(Number(input.etaSeconds || 0))),
    workerRegion: input.workerRegion || "pending",
    workerStatus: input.workerStatus || "queued",
  };
}

export function jobSummaryFromRow(row: Record<string, unknown>): JobSummary {
  return summary({
    jobId: String(row.id || ""),
    status: String(row.status || "queued") as JobSummary["status"],
    accountCount: Number(row.account_count || 0),
    directedPairs: Number(row.directed_pairs || 0),
    blocked: Number(row.blocked || 0),
    alreadyBlocked: Number(row.already_blocked || 0),
    failed: Number(row.failed || 0),
    reservedBaht: Number(row.reserved_baht || 0),
    chargedBaht: Number(row.charged_baht || 0),
    refundedBaht: Number(row.refunded_baht || 0),
    workerRegion: String(row.worker_region || "pending"),
    workerStatus: String(row.worker_status || "queued") as JobSummary["workerStatus"],
    createdAt: String(row.created_at || ""),
  });
}

async function refundDispatchFailure(
  admin: SupabaseClient,
  input: {
    userId: string;
    jobId: string;
    accountCount: number;
    directedPairs: number;
    amountBaht: number;
    error: string;
  },
): Promise<JobSummary> {
  await admin.from("wallet_ledger").upsert({
    user_id: input.userId,
    job_id: input.jobId,
    type: "refund",
    amount_baht: input.amountBaht,
    label: `Refund failed worker dispatch for ${input.jobId}`,
    provider: "wallet",
    reference: `${input.jobId}:dispatch-refund`,
    status: "posted",
  }, { onConflict: "provider,reference", ignoreDuplicates: true });

  await admin.from("jobs").update({
    status: "failed",
    worker_region: "external-worker-error",
    worker_status: "failed",
    failed: input.directedPairs,
    refunded_baht: input.amountBaht,
    updated_at: new Date().toISOString(),
  }).eq("id", input.jobId);

  await admin.from("job_reports").insert({
    job_id: input.jobId,
    user_id: input.userId,
    report_json: {
      jobId: input.jobId,
      source: "external-worker-dispatch",
      failed: true,
      error: input.error,
      secretsPolicy: "report_redaction_enabled",
    },
  });

  return summary({
    jobId: input.jobId,
    status: "failed",
    accountCount: input.accountCount,
    directedPairs: input.directedPairs,
    failed: input.directedPairs,
    reservedBaht: input.amountBaht,
    refundedBaht: input.amountBaht,
    workerRegion: "external-worker-error",
    workerStatus: "failed",
  });
}

export async function confirmJobForUser(input: ConfirmJobInput): Promise<JobSummary> {
  const {
    admin,
    userId,
    source = "web",
    note = "",
    freeMode = false,
  } = input;
  let mode: BlockMeshMode = input.mode === "stable" ? "stable" : "balanced";
  let accountText = String(input.accountText || "");
  let accountCount = resolveAccountCount({ accountCount: input.accountCount, accountText });

  if (accountText.trim()) {
    const validation = validateAccountInput(accountText, { required: true });
    if (!validation.ok) throw new JobServiceError(400, validation.error || "Invalid account input");
  }
  if (!Number.isFinite(accountCount) || accountCount < 2 || accountCount > 5000) {
    throw new JobServiceError(400, "accountCount must be between 2 and 5000");
  }

  const { count: activeJobsCount, error: activeJobsError } = await admin
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .in("status", ["queued", "running", "retrying"]);
  if (activeJobsError) throw new JobServiceError(500, activeJobsError.message);
  if ((activeJobsCount || 0) >= maxActiveJobsPerUser()) {
    throw new JobServiceError(429, "Active job limit reached. Wait for the current job to finish.");
  }

  const draftId = input.draftId || null;
  let jobId = draftId;
  let quote = createQuote(accountCount, mode);

  if (draftId) {
    const { data: existingDraft, error } = await admin
      .from("jobs")
      .select("account_count,mode,status,source")
      .eq("id", draftId)
      .eq("user_id", userId)
      .single();
    if (error || !existingDraft) throw new JobServiceError(404, error?.message || "Draft not found");
    if (existingDraft.status !== "draft") throw new JobServiceError(409, "Only draft jobs can be confirmed");

    mode = existingDraft.mode === "stable" ? "stable" : "balanced";
    accountCount = Number(existingDraft.account_count || accountCount);
    quote = createQuote(accountCount, mode);
    if (accountText.trim()) {
      const { error: inputError } = await admin.from("job_inputs").upsert({
        job_id: draftId,
        user_id: userId,
        account_text: encryptSecret(accountText),
        status: "stored",
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      }, { onConflict: "job_id" });
      if (inputError) throw new JobServiceError(500, inputError.message);
    }
  } else {
    const { data, error } = await admin
      .from("jobs")
      .insert({
        user_id: userId,
        source,
        status: "draft",
        mode,
        account_count: quote.accountCount,
        directed_pairs: quote.directedPairs,
        price_per_pair_baht: quote.pricePerPair,
        reserved_baht: quote.estimatedCostBaht,
        worker_region: "pending",
        worker_status: "queued",
        note,
      })
      .select("id")
      .single();
    if (error || !data) throw new JobServiceError(500, error?.message || "Job create failed");
    jobId = data.id;

    if (accountText.trim()) {
      const { error: inputError } = await admin.from("job_inputs").insert({
        job_id: jobId,
        user_id: userId,
        account_text: encryptSecret(accountText),
        status: "stored",
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });
      if (inputError) throw new JobServiceError(500, inputError.message);
    }
  }

  if (!jobId) throw new JobServiceError(500, "Job id is missing");

  if (!accountText.trim()) {
    const { data: storedInput } = await admin
      .from("job_inputs")
      .select("account_text")
      .eq("job_id", jobId)
      .eq("user_id", userId)
      .maybeSingle();
    accountText = decryptSecret(storedInput?.account_text || "");
  }

  const validation = validateAccountInput(accountText, { required: true });
  if (!validation.ok) throw new JobServiceError(400, validation.error || "Invalid stored account input");
  accountCount = resolveAccountCount({ accountCount, accountText });
  const verifiedQuote = createQuote(accountCount, mode);
  if (verifiedQuote.accountCount !== quote.accountCount || verifiedQuote.directedPairs !== quote.directedPairs) {
    throw new JobServiceError(409, "Account count changed after quote. Recreate the draft.");
  }
  quote = verifiedQuote;

  if (!hasWorkerApi() && !input.runLocalJob) {
    throw new JobServiceError(503, "Worker is not configured");
  }

  let balance = await getWalletBalanceBaht(userId);
  if (freeMode && balance < quote.estimatedCostBaht) {
    const freeCredit = Math.max(0, quote.estimatedCostBaht - balance);
    const { error: topUpError } = await admin.from("wallet_ledger").upsert({
      user_id: userId,
      job_id: jobId,
      type: "topup",
      amount_baht: freeCredit,
      label: `Discord free mode credit for ${jobId}`,
      provider: "bot_free_mode",
      reference: `${jobId}:free-credit`,
      status: "posted",
    }, { onConflict: "provider,reference", ignoreDuplicates: true });
    if (topUpError) throw new JobServiceError(500, topUpError.message);
    balance = await getWalletBalanceBaht(userId);
  }
  if (balance < quote.estimatedCostBaht) {
    throw new JobServiceError(402, "Wallet balance is not enough for this job");
  }

  const { error: ledgerError } = await admin.from("wallet_ledger").upsert({
    user_id: userId,
    job_id: jobId,
    type: "reserve",
    amount_baht: -quote.estimatedCostBaht,
    label: `Reserved for ${jobId}`,
    provider: "wallet",
    reference: jobId,
    status: "reserved",
  }, { onConflict: "provider,reference", ignoreDuplicates: true });
  if (ledgerError) throw new JobServiceError(500, ledgerError.message);

  const { error: queueError } = await admin.from("jobs").update({
    status: "queued",
    source,
    reserved_baht: quote.estimatedCostBaht,
    worker_status: "queued",
    updated_at: new Date().toISOString(),
  }).eq("id", jobId).eq("user_id", userId);
  if (queueError) {
    await admin.from("wallet_ledger").upsert({
      user_id: userId,
      job_id: jobId,
      type: "refund",
      amount_baht: quote.estimatedCostBaht,
      label: `Refund failed queue transition for ${jobId}`,
      provider: "wallet",
      reference: `${jobId}:queue-refund`,
      status: "posted",
    }, { onConflict: "provider,reference", ignoreDuplicates: true });
    throw new JobServiceError(500, queueError.message);
  }

  if (hasWorkerApi()) {
    const dispatch = await dispatchWorkerJob({
      jobId,
      userId,
      mode,
      accountCount: quote.accountCount,
      directedPairs: quote.directedPairs,
      pricePerPairBaht: quote.pricePerPair,
      accountText,
      callbackBaseUrl: process.env.NEXT_PUBLIC_SITE_URL,
    });

    await admin.from("jobs").update({
      worker_region: dispatch.queued ? "external-worker" : "external-worker-error",
      worker_status: dispatch.queued ? "connected" : "failed",
      status: dispatch.queued ? "queued" : "failed",
      updated_at: new Date().toISOString(),
    }).eq("id", jobId);

    if (!dispatch.queued) {
      const failedJob = await refundDispatchFailure(admin, {
        userId,
        jobId,
        accountCount: quote.accountCount,
        directedPairs: quote.directedPairs,
        amountBaht: quote.estimatedCostBaht,
        error: dispatch.error || "Worker did not accept the job",
      });
      throw new JobServiceError(502, dispatch.error || "Worker did not accept the job", { job: failedJob });
    }
  } else {
    void input.runLocalJob?.({
      jobId,
      userId,
      mode,
      pricePerPairBaht: quote.pricePerPair,
    });
  }

  return summary({
    jobId,
    status: "queued",
    accountCount: quote.accountCount,
    directedPairs: quote.directedPairs,
    reservedBaht: quote.estimatedCostBaht,
    etaSeconds: Math.round(quote.estimatedDurationMinutes * 60),
    workerRegion: "pending",
    workerStatus: "queued",
  });
}

export async function getJobForUser(
  admin: SupabaseClient,
  userId: string,
  jobId: string,
): Promise<JobSummary> {
  const { data, error } = await admin
    .from("jobs")
    .select("*")
    .eq("id", jobId)
    .eq("user_id", userId)
    .single();
  if (error || !data) throw new JobServiceError(404, error?.message || "Job not found");
  return jobSummaryFromRow(data as Record<string, unknown>);
}
