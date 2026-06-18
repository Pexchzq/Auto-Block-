import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { roundBaht } from "@/lib/pricing";
import { decryptSecret } from "@/lib/secret-storage";
import { sanitizeReportValue } from "@/lib/report-sanitizer";

type RunLocalBlockMeshOptions = {
  jobId: string;
  userId: string;
  mode: "balanced" | "stable";
  pricePerPairBaht: number;
};

type BlockReport = {
  blocked?: number;
  alreadyBlocked?: number;
  already_blocked?: number;
  failed?: number;
  directedPairs?: number;
  accountsUsed?: number;
  durationMs?: number;
  [key: string]: unknown;
};

const DEFAULT_CLI_DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), "blockmesh-cli");

function cliDir(): string {
  return process.env.BLOCKMESH_CLI_DIR || DEFAULT_CLI_DIR;
}

function cliExecutable(): string {
  return process.env.BLOCKMESH_EXE || path.join(cliDir(), "blockmesh.exe");
}

async function newestReportSince(reportsDir: string, sinceMs: number): Promise<string | null> {
  const files = await readdir(reportsDir, { withFileTypes: true }).catch(() => []);
  const reports = await Promise.all(files
    .filter((file) => file.isFile() && /^block-report-.*\.json$/i.test(file.name))
    .map(async (file) => {
      const fullPath = path.join(reportsDir, file.name);
      const stat = await import("node:fs/promises").then((fs) => fs.stat(fullPath));
      return { fullPath, mtimeMs: stat.mtimeMs };
    }));

  const latest = reports
    .filter((report) => report.mtimeMs >= sinceMs)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
  return latest?.fullPath || null;
}

function runCli(cookiesFile: string, mode: "balanced" | "stable"): Promise<void> {
  const exe = cliExecutable();
  const args = [
    "apply",
    "--cookies",
    cookiesFile,
    "--mode",
    mode === "stable" ? "safe" : "balanced",
    "--allow-unverified-blocklist",
    "--skip-block-list-check",
  ];

  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, {
      cwd: cliDir(),
      windowsHide: true,
      stdio: "ignore",
    });

    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`BlockMesh CLI exited with code ${code}`));
    });
  });
}

export async function runLocalBlockMeshJob(options: RunLocalBlockMeshOptions): Promise<void> {
  const admin = getSupabaseAdmin();
  if (!admin) return;

  const { data: input, error: inputError } = await admin
    .from("job_inputs")
    .select("account_text")
    .eq("job_id", options.jobId)
    .eq("user_id", options.userId)
    .single();

  if (inputError || !input?.account_text) {
    await admin.from("jobs").update({
      status: "failed",
      worker_status: "failed",
      updated_at: new Date().toISOString(),
    }).eq("id", options.jobId);
    return;
  }

  const startedAt = Date.now();
  const accountText = decryptSecret(input.account_text);
  const tempDir = path.join(/*turbopackIgnore: true*/ process.cwd(), ".tmp", "blockmesh-jobs", options.jobId);
  const cookiesFile = path.join(tempDir, "cookies.txt");
  const reportsDir = path.join(cliDir(), "reports");

  try {
    await mkdir(tempDir, { recursive: true });
    await writeFile(cookiesFile, accountText, "utf8");

    await admin.from("jobs").update({
      status: "running",
      worker_region: "local-cli",
      worker_status: "connected",
      updated_at: new Date().toISOString(),
    }).eq("id", options.jobId);

    await runCli(cookiesFile, options.mode);

    const reportPath = await newestReportSince(reportsDir, startedAt);
    const report = reportPath
      ? JSON.parse(await readFile(reportPath, "utf8")) as BlockReport
      : { failed: 0, blocked: 0, alreadyBlocked: 0 };

    const blocked = Number(report.blocked || 0);
    const alreadyBlocked = Number(report.alreadyBlocked || report.already_blocked || 0);
    const failed = Number(report.failed || 0);
    const chargedBaht = roundBaht((blocked + alreadyBlocked) * options.pricePerPairBaht);
    const refundedBaht = roundBaht(failed * options.pricePerPairBaht);

    await admin.from("jobs").update({
      status: failed > 0 ? "completed" : "completed",
      worker_status: "connected",
      blocked,
      already_blocked: alreadyBlocked,
      failed,
      charged_baht: chargedBaht,
      refunded_baht: refundedBaht,
      updated_at: new Date().toISOString(),
    }).eq("id", options.jobId);

    await admin.from("job_reports").insert({
      job_id: options.jobId,
      user_id: options.userId,
      report_json: {
        ...(sanitizeReportValue(report) as Record<string, unknown>),
        jobId: options.jobId,
        source: "local-blockmesh-cli",
        secretsPolicy: "cookies/passwords/tokens are never included in reports",
      },
    });

    if (refundedBaht > 0) {
      const { error: refundError } = await admin.from("wallet_ledger").upsert({
        user_id: options.userId,
        job_id: options.jobId,
        type: "refund",
        amount_baht: refundedBaht,
        label: `Refund failed pairs for ${options.jobId}`,
        provider: "wallet",
        reference: `${options.jobId}:refund`,
        status: "posted",
      }, { onConflict: "provider,reference", ignoreDuplicates: true });
      if (refundError) throw new Error(refundError.message);
    }

    await admin.from("job_inputs").update({ status: "consumed", account_text: "" }).eq("job_id", options.jobId);
  } catch (error) {
    await admin.from("jobs").update({
      status: "failed",
      worker_status: "failed",
      updated_at: new Date().toISOString(),
    }).eq("id", options.jobId);

    await admin.from("job_reports").insert({
      job_id: options.jobId,
      user_id: options.userId,
      report_json: {
        jobId: options.jobId,
        source: "local-blockmesh-cli",
        failed: true,
        error: error instanceof Error ? error.message : "Unknown worker error",
        secretsPolicy: "cookies/passwords/tokens are never included in reports",
      },
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
