"use client";

import { Activity, BriefcaseBusiness, Database, ShieldCheck, Users, WalletCards } from "lucide-react";
import { useEffect, useState } from "react";
import { getBrowserSupabase } from "@/lib/supabase-client";
import type { AdminAuditLogRow, AdminOverview, AdminUserRow, SystemStatus } from "@/types";

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatBaht(value: number): string {
  return new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB" }).format(value);
}

async function adminHeaders(): Promise<HeadersInit> {
  const supabase = getBrowserSupabase();
  const { data } = supabase ? await supabase.auth.getSession() : { data: { session: null } };
  return data.session?.access_token ? { authorization: `Bearer ${data.session.access_token}` } : {};
}

export default function AdminPage() {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [auditLogs, setAuditLogs] = useState<AdminAuditLogRow[]>([]);
  const [adjustAmount, setAdjustAmount] = useState<Record<string, string>>({});
  const [cleanupResult, setCleanupResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    setError(null);
    const response = await fetch("/api/admin/overview", { headers: await adminHeaders(), cache: "no-store" });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || `HTTP ${response.status}`);
      return;
    }
    setOverview(data as AdminOverview);

    const statusResponse = await fetch("/api/system/status", { headers: await adminHeaders(), cache: "no-store" });
    const statusData = await statusResponse.json();
    if (statusResponse.ok) setSystemStatus(statusData as SystemStatus);

    const usersResponse = await fetch("/api/admin/users", { headers: await adminHeaders(), cache: "no-store" });
    const usersData = await usersResponse.json();
    if (usersResponse.ok) setUsers(usersData.users as AdminUserRow[]);

    const auditResponse = await fetch("/api/admin/audit-logs", { headers: await adminHeaders(), cache: "no-store" });
    const auditData = await auditResponse.json();
    if (auditResponse.ok) setAuditLogs(auditData.logs as AdminAuditLogRow[]);
  }

  async function cancelJob(jobId: string) {
    setError(null);
    const response = await fetch(`/api/admin/jobs/${encodeURIComponent(jobId)}/cancel`, {
      method: "POST",
      headers: await adminHeaders(),
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || `HTTP ${response.status}`);
      return;
    }
    await refresh();
  }

  async function adjustWallet(userId: string) {
    const amount = Number(adjustAmount[userId] || 0);
    if (!Number.isFinite(amount) || amount === 0) {
      setError("Enter a non-zero wallet adjustment amount.");
      return;
    }

    setError(null);
    const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/adjust-wallet`, {
      method: "POST",
      headers: { ...(await adminHeaders()), "content-type": "application/json" },
      body: JSON.stringify({ amountBaht: amount, reason: "Manual admin wallet adjustment" }),
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || `HTTP ${response.status}`);
      return;
    }
    setAdjustAmount((current) => ({ ...current, [userId]: "" }));
    await refresh();
  }

  async function cleanupExpiredInputs() {
    setError(null);
    setCleanupResult(null);
    const response = await fetch("/api/admin/cleanup/expired-inputs", {
      method: "POST",
      headers: await adminHeaders(),
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || `HTTP ${response.status}`);
      return;
    }
    setCleanupResult(`Cleaned ${data.cleaned || 0} expired input(s).`);
    await refresh();
  }

  return (
    <main className="admin-shell">
      <section className="admin-hero">
        <div>
          <span><ShieldCheck size={16} /> Admin Console</span>
          <h1>BlockMesh Operations</h1>
          <p>Monitor users, wallet ledger totals, job queue, and recent requests.</p>
        </div>
        <button onClick={refresh}>Refresh</button>
      </section>

      {error && <div className="admin-error">{error}</div>}

      <section className="admin-metrics">
        <Metric icon={<Users />} label="Users" value={formatNumber(overview?.users || 0)} />
        <Metric icon={<BriefcaseBusiness />} label="Jobs" value={formatNumber(overview?.jobs || 0)} />
        <Metric icon={<Activity />} label="Running" value={formatNumber(overview?.runningJobs || 0)} />
        <Metric icon={<Database />} label="Queued" value={formatNumber(overview?.queuedJobs || 0)} />
        <Metric icon={<WalletCards />} label="Wallet total" value={formatBaht(overview?.walletBalanceTotalBaht || 0)} />
      </section>

      <section className="admin-table">
        <h2>System readiness</h2>
        <div className="admin-status-grid">
          <StatusBox label="Supabase" ok={systemStatus?.supabase.ok} detail={String(systemStatus?.supabase.detail || "unknown")} />
          <StatusBox label="Worker" ok={systemStatus?.worker.ok} detail={systemStatus?.worker.configured ? JSON.stringify(systemStatus.worker.detail) : "not configured"} />
          <StatusBox label="Dispatch" ok={systemStatus?.workerDispatchConfigured} detail={systemStatus?.workerDispatchConfigured ? "configured" : "missing worker env"} />
          <StatusBox label="Input encryption" ok={systemStatus?.encryption.ok} detail={systemStatus?.encryption.configured ? "configured" : "missing JOB_INPUT_ENCRYPTION_KEY"} />
          <StatusBox label="Job quota" ok={systemStatus?.quota.ok} detail={`max active jobs=${systemStatus?.quota.maxActiveJobsPerUser || "unknown"}`} />
          <StatusBox label="Payment" ok={systemStatus?.payment.mode === "placeholder" && !systemStatus?.payment.placeholderTopUpEnabled} detail={`mode=${systemStatus?.payment.mode || "unknown"}, placeholder top-up=${systemStatus?.payment.placeholderTopUpEnabled ? "enabled" : "disabled"}`} />
        </div>
        <div className="admin-maintenance">
          <button onClick={() => void cleanupExpiredInputs()}>Clean expired account inputs</button>
          {cleanupResult && <span>{cleanupResult}</span>}
        </div>
      </section>

      <section className="admin-table">
        <h2>Latest jobs</h2>
        <div className="admin-rows">
          {(overview?.latestJobs || []).map((job) => (
            <div className="admin-row" key={job.jobId}>
              <span>{job.status}</span>
              <strong>{job.email || "unknown user"}</strong>
              <span>{formatNumber(job.accountsUsed)} accounts</span>
              <span>{formatNumber(job.directedPairs)} pairs</span>
              <span>{formatBaht(job.reservedBaht)}</span>
              <button
                disabled={["completed", "failed", "cancelled"].includes(job.status)}
                onClick={() => void cancelJob(job.jobId)}
              >
                Cancel
              </button>
            </div>
          ))}
          {overview && overview.latestJobs.length === 0 && <div className="admin-empty">No jobs yet.</div>}
        </div>
      </section>

      <section className="admin-table">
        <h2>Users and wallet</h2>
        <div className="admin-rows">
          {users.map((user) => (
            <div className="admin-user-row" key={user.userId}>
              <strong>{user.email || "unknown user"}</strong>
              <span>{user.role}</span>
              <span>{formatBaht(user.balanceBaht)}</span>
              <span>{formatNumber(user.jobs)} jobs</span>
              <input
                value={adjustAmount[user.userId] || ""}
                onChange={(event) => setAdjustAmount((current) => ({ ...current, [user.userId]: event.target.value }))}
                placeholder="+100 / -50"
                type="number"
              />
              <button onClick={() => void adjustWallet(user.userId)}>Adjust</button>
            </div>
          ))}
          {users.length === 0 && <div className="admin-empty">No users found.</div>}
        </div>
      </section>

      <section className="admin-table">
        <h2>Audit logs</h2>
        <div className="admin-rows">
          {auditLogs.map((log) => (
            <div className="admin-audit-row" key={log.id}>
              <span>{new Date(log.createdAt).toLocaleString()}</span>
              <strong>{log.action}</strong>
              <span>{log.actorEmail || "system"}</span>
              <span>{log.targetType || "-"} {log.targetId ? log.targetId.slice(0, 8) : ""}</span>
              <code>{JSON.stringify(log.metadata)}</code>
            </div>
          ))}
          {auditLogs.length === 0 && <div className="admin-empty">No audit logs yet.</div>}
        </div>
      </section>
    </main>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="admin-metric">{icon}<span>{label}</span><strong>{value}</strong></div>;
}

function StatusBox({ detail, label, ok }: { detail: string; label: string; ok?: boolean }) {
  return (
    <div className={ok ? "admin-status ok" : "admin-status bad"}>
      <span>{label}</span>
      <strong>{ok ? "OK" : "Check"}</strong>
      <p>{detail}</p>
    </div>
  );
}
