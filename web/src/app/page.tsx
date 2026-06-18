"use client";

import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ChevronRight,
  Clock3,
  CreditCard,
  Database,
  Download,
  FileText,
  LockKeyhole,
  LogOut,
  Moon,
  Network,
  Radar,
  RefreshCcw,
  ShieldCheck,
  Sun,
  Terminal,
  UploadCloud,
  UserRound,
  WalletCards,
  X,
  Zap,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getBrowserSupabase, hasPublicSupabaseConfig } from "@/lib/supabase-client";
import type { BlockMeshMode, JobDraftResponse, JobSummary, PaymentStatus, QuoteResponse, VoucherPreviewResponse, WalletSnapshot, WalletTopUpResponse } from "@/types";

const sampleCounts = [50, 100, 220, 500];
const WALLET_STORAGE_KEY = "blockmesh.wallet.v1";
const THEME_STORAGE_KEY = "blockmesh.theme.v1";

type WalletEvent = {
  id: string;
  type: "topup" | "reserve" | "refund";
  amountBaht: number;
  label: string;
  createdAt: string;
};

type ActivityEvent = {
  id: string;
  tone: "cyan" | "green" | "gold" | "red";
  label: string;
  detail: string;
};

function readInitialTheme(): "dark" | "light" {
  if (typeof window === "undefined") return "dark";
  return window.localStorage.getItem(THEME_STORAGE_KEY) === "light" ? "light" : "dark";
}

function readInitialWallet(): { balance: number; events: WalletEvent[] } {
  if (typeof window === "undefined") return { balance: 0, events: [] };
  try {
    const savedWallet = window.localStorage.getItem(WALLET_STORAGE_KEY);
    if (!savedWallet) return { balance: 0, events: [] };
    const parsed = JSON.parse(savedWallet) as { balance?: number; events?: WalletEvent[] };
    return {
      balance: typeof parsed.balance === "number" ? parsed.balance : 0,
      events: Array.isArray(parsed.events) ? parsed.events.slice(0, 8) : [],
    };
  } catch {
    return { balance: 0, events: [] };
  }
}

async function authHeaders(): Promise<HeadersInit> {
  const supabase = getBrowserSupabase();
  if (!supabase) return { "content-type": "application/json" };
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token
    ? { "content-type": "application/json", authorization: `Bearer ${token}` }
    : { "content-type": "application/json" };
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || data.message || `HTTP ${response.status}`);
  return data as T;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store", headers: await authHeaders() });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || data.message || `HTTP ${response.status}`);
  return data as T;
}

async function getJsonWithToken<T>(url: string, token: string): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { authorization: `Bearer ${token}` },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || data.message || `HTTP ${response.status}`);
  return data as T;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatBaht(value: number): string {
  return new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatMinutes(value: number): string {
  if (value < 1) return "< 1 min";
  if (value < 60) return `${value.toFixed(value % 1 ? 1 : 0)} min`;
  return `${Math.floor(value / 60)}h ${Math.round(value % 60)}m`;
}

function pairsFor(accounts: number): number {
  return accounts > 1 ? accounts * (accounts - 1) : 0;
}

function eventId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 6)}`;
}

export default function Home() {
  const initialWallet = useMemo(() => readInitialWallet(), []);
  const [theme, setTheme] = useState<"dark" | "light">(() => readInitialTheme());
  const [session, setSession] = useState<Session | null>(null);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [accountText, setAccountText] = useState("");
  const [manualCount, setManualCount] = useState(80);
  const [mode, setMode] = useState<BlockMeshMode>("balanced");
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [draft, setDraft] = useState<JobDraftResponse | null>(null);
  const [voucherUrl, setVoucherUrl] = useState("");
  const [voucher, setVoucher] = useState<VoucherPreviewResponse | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus | null>(null);
  const [walletBalance, setWalletBalance] = useState(initialWallet.balance);
  const [walletEvents, setWalletEvents] = useState<WalletEvent[]>(initialWallet.events);
  const [lastTopUp, setLastTopUp] = useState<WalletTopUpResponse | null>(null);
  const [job, setJob] = useState<JobSummary | null>(null);
  const [recentJobs, setRecentJobs] = useState<JobSummary[]>([]);
  const [report, setReport] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const supabaseEnabled = hasPublicSupabaseConfig();

  const detectedCount = useMemo(() => {
    const lines = accountText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
    return lines.length;
  }, [accountText]);

  const accountCount = detectedCount || manualCount;
  const directedPairs = pairsFor(accountCount);
  const completed = job ? job.blocked + job.alreadyBlocked + job.failed : 0;
  const progress = job && job.directedPairs > 0 ? Math.min(100, Math.round((completed / job.directedPairs) * 100)) : 0;
  const currentCostBaht = quote?.estimatedCostBaht ?? directedPairs * (directedPairs > 50000 ? 0.005 : 0.01);
  const hasEnoughBalance = walletBalance >= currentCostBaht;
  const needsLogin = supabaseEnabled && !session;
  const showAuthGate = supabaseEnabled && !session;

  const activityEvents: ActivityEvent[] = useMemo(() => {
    const base: ActivityEvent[] = [
      { id: "env", tone: supabaseEnabled ? "green" : "gold", label: "AUTH", detail: supabaseEnabled ? "Supabase bridge armed" : "Demo mode active" },
      { id: "quote", tone: quote ? "cyan" : "gold", label: "QUOTE", detail: quote ? `${formatNumber(quote.directedPairs)} pairs priced` : "Awaiting calculation" },
      { id: "wallet", tone: walletBalance > 0 ? "green" : "gold", label: "WALLET", detail: `${formatBaht(walletBalance)} available` },
      { id: "worker", tone: job ? "cyan" : "gold", label: "WORKER", detail: job ? `${job.workerStatus} / ${job.status}` : "No job dispatched" },
    ];
    return base.concat(walletEvents.slice(0, 4).map((event) => ({
      id: event.id,
      tone: event.amountBaht >= 0 ? "green" : "gold",
      label: event.type.toUpperCase(),
      detail: `${event.label} ${formatBaht(event.amountBaht)}`,
    })));
  }, [job, quote, supabaseEnabled, walletBalance, walletEvents]);

  useEffect(() => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Ignore unavailable storage.
    }
  }, [theme]);

  useEffect(() => {
    void getJson<PaymentStatus>("/api/payments/status")
      .then(setPaymentStatus)
      .catch(() => setPaymentStatus(null));
  }, []);

  useEffect(() => {
    try {
      if (session) {
        window.localStorage.removeItem(WALLET_STORAGE_KEY);
        return;
      }
      window.localStorage.setItem(WALLET_STORAGE_KEY, JSON.stringify({
        balance: walletBalance,
        events: walletEvents.slice(0, 8),
      }));
    } catch {
      // Ignore unavailable storage.
    }
  }, [session, walletBalance, walletEvents]);

  function pushWalletEvent(event: Omit<WalletEvent, "id" | "createdAt">) {
    setWalletEvents((current) => [{
      ...event,
      id: eventId(event.type),
      createdAt: new Date().toISOString(),
    }, ...current].slice(0, 8));
  }

  async function submitAuth(event: FormEvent) {
    event.preventDefault();
    const supabase = getBrowserSupabase();
    if (!supabase) {
      setError("Supabase env is not configured yet.");
      return;
    }

    setBusy("auth");
    setError(null);
    const result = authMode === "signup"
      ? await supabase.auth.signUp({ email: authEmail, password: authPassword })
      : await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword });

    if (result.error) setError(result.error.message);
    setBusy(null);
  }

  async function logout() {
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    await supabase.auth.signOut();
    setSession(null);
    setWalletBalance(0);
    setWalletEvents([]);
  }

  const applyWalletSnapshot = useCallback((data: WalletSnapshot) => {
    setWalletBalance(data.balanceBaht);
    setWalletEvents(data.events.map((event) => ({
      id: event.id,
      type: event.type === "capture" || event.type === "manual_adjust" ? "topup" : event.type,
      amountBaht: event.amountBaht,
      label: event.label,
      createdAt: event.createdAt,
    })));
  }, []);

  const refreshWalletForToken = useCallback(async (token: string) => {
    setBusy("wallet");
    try {
      applyWalletSnapshot(await getJsonWithToken<WalletSnapshot>("/api/wallet", token));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Wallet refresh failed");
    } finally {
      setBusy(null);
    }
  }, [applyWalletSnapshot]);

  const refreshWallet = useCallback(async () => {
    if (!session) return;
    await refreshWalletForToken(session.access_token);
  }, [refreshWalletForToken, session]);

  const refreshJobs = useCallback(async () => {
    if (!supabaseEnabled) return;
    try {
      const data = await getJson<{ jobs: JobSummary[] }>("/api/jobs");
      setRecentJobs(data.jobs);
      setJob((current) => current || data.jobs[0] || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Job history refresh failed");
    }
  }, [supabaseEnabled]);

  useEffect(() => {
    const supabase = getBrowserSupabase();
    if (!supabase) return;

    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session?.access_token) {
        void refreshWalletForToken(data.session.access_token);
        void refreshJobs();
      }
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (nextSession?.access_token) {
        void refreshWalletForToken(nextSession.access_token);
        void refreshJobs();
      }
    });

    return () => data.subscription.unsubscribe();
  }, [refreshJobs, refreshWalletForToken]);

  async function runQuote(nextCount = accountCount) {
    setBusy("quote");
    setError(null);
    try {
      setQuote(await postJson<QuoteResponse>("/api/quote", { accountCount: nextCount, mode, accountText }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Quote failed");
    } finally {
      setBusy(null);
    }
  }

  async function createDraft() {
    setBusy("draft");
    setError(null);
    try {
      const data = await postJson<JobDraftResponse>("/api/jobs/draft", {
        accountCount,
        mode,
        note: "Cyber console draft",
        accountText,
      });
      setDraft(data);
      setQuote(data.quote);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Draft failed");
    } finally {
      setBusy(null);
    }
  }

  async function previewVoucher(event?: FormEvent) {
    event?.preventDefault();
    setBusy("voucher");
    setError(null);
    try {
      setVoucher(await postJson<VoucherPreviewResponse>("/api/payments/voucher/preview", { voucherUrl }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Voucher preview failed");
    } finally {
      setBusy(null);
    }
  }

  async function topUpWallet() {
    setBusy("topup");
    setError(null);
    try {
      const data = await postJson<WalletTopUpResponse>("/api/wallet/topup", { voucherUrl });
      setLastTopUp(data);
      if (data.accepted) {
        if (session) {
          await refreshWallet();
        } else {
          setWalletBalance((current) => Math.round((current + data.creditedBaht) * 100) / 100);
          pushWalletEvent({ type: "topup", amountBaht: data.creditedBaht, label: "TrueMoney wallet top-up" });
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Wallet top-up failed");
    } finally {
      setBusy(null);
    }
  }

  async function confirmJob() {
    if (!hasEnoughBalance) {
      setError(`Wallet balance is short by ${formatBaht(Math.max(0, currentCostBaht - walletBalance))}.`);
      return;
    }

    setBusy("confirm");
    setError(null);
    try {
      const data = await postJson<{ job: JobSummary }>("/api/jobs/confirm", {
        draftId: draft?.draftId,
        accountCount,
        mode,
        accountText,
      });
      setJob(data.job);
      setRecentJobs((current) => [data.job, ...current.filter((item) => item.jobId !== data.job.jobId)].slice(0, 20));
      if (session) {
        await refreshWallet();
        await refreshJobs();
      } else {
        setWalletBalance((current) => Math.max(0, Math.round((current - data.job.reservedBaht) * 100) / 100));
        pushWalletEvent({ type: "reserve", amountBaht: -data.job.reservedBaht, label: `Reserved for ${data.job.jobId}` });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Confirm failed");
    } finally {
      setBusy(null);
    }
  }

  async function refreshJob() {
    if (!job) return;
    setBusy("job");
    setError(null);
    try {
      const data = await getJson<{ job: JobSummary }>(`/api/jobs/${encodeURIComponent(job.jobId)}`);
      setJob(data.job);
      setRecentJobs((current) => [data.job, ...current.filter((item) => item.jobId !== data.job.jobId)].slice(0, 20));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Status refresh failed");
    } finally {
      setBusy(null);
    }
  }

  async function loadReport() {
    if (!job) return;
    setBusy("report");
    setError(null);
    try {
      setReport(await getJson<Record<string, unknown>>(`/api/jobs/${encodeURIComponent(job.jobId)}/report`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Report load failed");
    } finally {
      setBusy(null);
    }
  }

  async function cancelJob() {
    if (!job) return;
    setBusy("cancel");
    setError(null);
    try {
      await postJson(`/api/jobs/${encodeURIComponent(job.jobId)}/cancel`, {});
      await refreshJob();
      if (session) await refreshWallet();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cancel failed");
    } finally {
      setBusy(null);
    }
  }

  if (showAuthGate) {
    return (
      <main className="console-app auth-only" data-theme={theme}>
        <div className="motion-field" aria-hidden="true">
          <div className="grid-plane" />
          <div className="scan-line" />
          <div className="signal-node node-a" />
          <div className="signal-node node-b" />
          <div className="signal-node node-c" />
        </div>

        <TopBar
          authMode={authMode}
          balance={walletBalance}
          busy={busy}
          job={job}
          onAuthMode={setAuthMode}
          onLogout={logout}
          onOpenTopUp={() => setTopUpOpen(true)}
          onProfileOpen={setProfileOpen}
          onToggleTheme={() => setTheme(theme === "dark" ? "light" : "dark")}
          profileOpen={profileOpen}
          session={session}
          supabaseEnabled={supabaseEnabled}
          theme={theme}
        />

        <AuthGate
          authEmail={authEmail}
          authMode={authMode}
          authPassword={authPassword}
          busy={busy}
          error={error}
          onAuthEmail={setAuthEmail}
          onAuthMode={setAuthMode}
          onAuthPassword={setAuthPassword}
          onSubmit={submitAuth}
        />
      </main>
    );
  }

  return (
    <main className="console-app" data-theme={theme}>
      <div className="motion-field" aria-hidden="true">
        <div className="grid-plane" />
        <div className="scan-line" />
        <div className="signal-node node-a" />
        <div className="signal-node node-b" />
        <div className="signal-node node-c" />
      </div>

      <TopBar
        authMode={authMode}
        balance={walletBalance}
        busy={busy}
        job={job}
        onAuthMode={setAuthMode}
        onLogout={logout}
        onOpenTopUp={() => setTopUpOpen(true)}
        onProfileOpen={setProfileOpen}
        onToggleTheme={() => setTheme(theme === "dark" ? "light" : "dark")}
        profileOpen={profileOpen}
        session={session}
        supabaseEnabled={supabaseEnabled}
        theme={theme}
      />

      <div className="console-layout">
        <section className="command-zone">
          <div className="zone-heading">
            <div>
              <StatusChip tone="cyan" label="COMMAND FLOW" icon={<Terminal size={14} />} />
              <h1>Dispatch block mesh jobs from one control surface.</h1>
            </div>
            <div className="flow-line" aria-hidden="true">
              <span className={quote ? "active" : ""}>Quote</span>
              <ChevronRight size={15} />
              <span className={draft ? "active" : ""}>Reserve</span>
              <ChevronRight size={15} />
              <span className={job ? "active" : ""}>Worker</span>
              <ChevronRight size={15} />
              <span className={report ? "active" : ""}>Report</span>
            </div>
          </div>

          {error && <div className="console-alert"><AlertTriangle size={17} /> {error}</div>}

          <div className="command-grid">
            <CreateJobPanel
              accountCount={accountCount}
              accountText={accountText}
              busy={busy}
              detectedCount={detectedCount}
              manualCount={manualCount}
              mode={mode}
              onAccountText={setAccountText}
              onCreateDraft={createDraft}
              onManualCount={setManualCount}
              onMode={setMode}
              onQuote={() => runQuote()}
            />
            <QuoteTerminal
              accountCount={accountCount}
              currentCostBaht={currentCostBaht}
              directedPairs={directedPairs}
              hasEnoughBalance={hasEnoughBalance}
              needsLogin={needsLogin}
              onConfirm={confirmJob}
              onOpenTopUp={() => setTopUpOpen(true)}
              quote={quote}
              sampleCounts={sampleCounts}
              setManualCount={setManualCount}
              runQuote={runQuote}
              busy={busy}
            />
          </div>
        </section>

        <aside className="monitor-zone">
          <WorkerMonitor job={job} progress={progress} onCancel={cancelJob} onRefresh={refreshJob} busy={busy} />
          <RecentJobsPanel
            busy={busy}
            jobs={recentJobs}
            onRefresh={refreshJobs}
            onSelect={(selected) => {
              setJob(selected);
              setReport(null);
            }}
            selectedJobId={job?.jobId || null}
          />
          <ActivityFeed events={activityEvents} />
        </aside>
      </div>

      <section className="report-grid">
        <RecentWalletActivity currentCostBaht={currentCostBaht} job={job} walletBalance={walletBalance} walletEvents={walletEvents} />
        <ReportConsole busy={busy} job={job} onLoadReport={loadReport} report={report} />
      </section>

      <TopUpDialog
        busy={busy}
        isOpen={topUpOpen}
        lastTopUp={lastTopUp}
        needsLogin={needsLogin}
        onClose={() => setTopUpOpen(false)}
        onPreview={previewVoucher}
        onTopUp={topUpWallet}
        onVoucher={setVoucherUrl}
        paymentStatus={paymentStatus}
        voucher={voucher}
        voucherUrl={voucherUrl}
      />
    </main>
  );
}

function TopBar({
  authMode,
  balance,
  busy,
  job,
  onAuthMode,
  onLogout,
  onOpenTopUp,
  onProfileOpen,
  onToggleTheme,
  profileOpen,
  session,
  supabaseEnabled,
  theme,
}: {
  authMode: "login" | "signup";
  balance: number;
  busy: string | null;
  job: JobSummary | null;
  onAuthMode: (value: "login" | "signup") => void;
  onLogout: () => void;
  onOpenTopUp: () => void;
  onProfileOpen: (value: boolean) => void;
  onToggleTheme: () => void;
  profileOpen: boolean;
  session: Session | null;
  supabaseEnabled: boolean;
  theme: "dark" | "light";
}) {
  const email = session?.user.email || "";
  const userLabel = email || session?.user.id || "Operator";

  return (
    <header className="top-bar">
      <div className="brand-lockup">
        <div className="brand-core"><Network size={20} /></div>
        <div>
          <strong>BlockMesh</strong>
          <span>Cyber Console</span>
        </div>
      </div>

      <div className="top-status">
        <StatusChip tone={job ? "cyan" : "gold"} label={job ? `${job.workerStatus}` : "worker idle"} icon={<Radar size={14} />} />
        <StatusChip tone={supabaseEnabled ? "green" : "gold"} label={supabaseEnabled ? "supabase" : "demo"} icon={<Database size={14} />} />
      </div>

      <div className="top-wallet">
        <button className="balance-chip" onClick={onOpenTopUp}>
          <WalletCards size={17} />
          <span>{formatBaht(balance)}</span>
        </button>
        <button className="topup-button" onClick={onOpenTopUp} disabled={busy === "topup"}>
          <CreditCard size={16} />
          <span>Top Up</span>
        </button>
      </div>

      <div className="profile-cluster">
        <button className="icon-button" onClick={onToggleTheme} aria-label="Toggle theme">
          {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
        </button>
        {!session && supabaseEnabled ? (
          <div className="auth-nav">
            <button className={authMode === "login" ? "active" : ""} onClick={() => onAuthMode("login")}>Login</button>
            <button className={authMode === "signup" ? "active" : ""} onClick={() => onAuthMode("signup")}>Sign Up</button>
          </div>
        ) : session ? (
          <div className="profile-menu-wrap">
            <button className="avatar-button" onClick={() => onProfileOpen(!profileOpen)} aria-label="Open profile menu">
              <span>{initials(userLabel)}</span>
            </button>
            {profileOpen && (
              <div className="profile-menu">
                <div>
                  <span>Signed in</span>
                  <strong>{userLabel}</strong>
                </div>
                <button onClick={() => { onProfileOpen(false); void onLogout(); }}>
                  <LogOut size={15} /> Logout
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="profile-pill">
            <UserRound size={16} />
            <span>Demo</span>
          </div>
        )}
      </div>
    </header>
  );
}

function initials(value: string): string {
  const source = value.includes("@") ? value.split("@")[0] : value;
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  const first = parts[0]?.[0] || "U";
  const second = parts[1]?.[0] || parts[0]?.[1] || "";
  return `${first}${second}`.toUpperCase();
}

function StatusChip({ icon, label, tone }: { icon: React.ReactNode; label: string; tone: "cyan" | "green" | "gold" | "red" }) {
  return <span className={`status-chip ${tone}`}>{icon}<span>{label}</span></span>;
}

function CreateJobPanel({
  accountCount,
  accountText,
  busy,
  detectedCount,
  manualCount,
  mode,
  onAccountText,
  onCreateDraft,
  onManualCount,
  onMode,
  onQuote,
}: {
  accountCount: number;
  accountText: string;
  busy: string | null;
  detectedCount: number;
  manualCount: number;
  mode: BlockMeshMode;
  onAccountText: (value: string) => void;
  onCreateDraft: () => void;
  onManualCount: (value: number) => void;
  onMode: (value: BlockMeshMode) => void;
  onQuote: () => void;
}) {
  return (
    <section className="console-panel command-panel">
      <PanelTitle icon={<UploadCloud size={18} />} kicker="INPUT STREAM" title="Create Job" />
      <div className="input-stack">
        <textarea
          value={accountText}
          onChange={(event) => onAccountText(event.target.value)}
          placeholder="username:password:_|WARNING:-DO-NOT-SHARE-THIS..."
          spellCheck={false}
        />
        <div className="control-row">
          <label>
            <span>Manual accounts</span>
            <input type="number" min={2} max={5000} value={manualCount} onChange={(event) => onManualCount(Number(event.target.value || 0))} />
          </label>
          <label>
            <span>Mode</span>
            <select value={mode} onChange={(event) => onMode(event.target.value as BlockMeshMode)}>
              <option value="balanced">Balanced</option>
              <option value="stable">Stable</option>
            </select>
          </label>
        </div>
      </div>
      <div className="command-actions">
        <button className="action-button primary" onClick={onQuote} disabled={busy === "quote"}>
          <BarChart3 size={17} /> Calculate Quote
        </button>
        <button className="action-button secondary" onClick={onCreateDraft} disabled={busy === "draft"}>
          <Zap size={17} /> Create Draft
        </button>
      </div>
      <div className="secure-note"><LockKeyhole size={15} /> {detectedCount ? `${formatNumber(detectedCount)} pasted lines detected` : `${formatNumber(accountCount)} accounts selected`} · secrets stay out of reports</div>
    </section>
  );
}

function QuoteTerminal({
  accountCount,
  busy,
  currentCostBaht,
  directedPairs,
  hasEnoughBalance,
  needsLogin,
  onConfirm,
  onOpenTopUp,
  quote,
  runQuote,
  sampleCounts,
  setManualCount,
}: {
  accountCount: number;
  busy: string | null;
  currentCostBaht: number;
  directedPairs: number;
  hasEnoughBalance: boolean;
  needsLogin: boolean;
  onConfirm: () => void;
  onOpenTopUp: () => void;
  quote: QuoteResponse | null;
  runQuote: (count?: number) => Promise<void>;
  sampleCounts: number[];
  setManualCount: (value: number) => void;
}) {
  const pairs = quote?.directedPairs ?? directedPairs;
  const eta = quote?.estimatedDurationMinutes ?? 0;

  return (
    <section className="console-panel quote-panel">
      <PanelTitle icon={<Terminal size={18} />} kicker="QUOTE TERMINAL" title="Pair Matrix" />
      <div className="pair-display">
        <div className="pair-number">{formatNumber(pairs)}</div>
        <span>directed pairs · {formatNumber(accountCount)} accounts</span>
      </div>
      <div className="quick-counts">
        {sampleCounts.map((count) => (
          <button key={count} onClick={() => { setManualCount(count); void runQuote(count); }}>
            <span>{count}</span>
            <strong>{formatNumber(pairsFor(count))}</strong>
          </button>
        ))}
      </div>
      <div className="quote-metrics">
        <MetricLine label="Cost" value={formatBaht(currentCostBaht)} />
        <MetricLine label="Rate" value={formatBaht(quote?.pricePerPair ?? (pairs > 50000 ? 0.005 : 0.01))} />
        <MetricLine label="Tier" value={quote?.pricingTier === "volume" ? "Volume" : "Standard"} />
        <MetricLine label="ETA" value={formatMinutes(eta)} />
      </div>
      {needsLogin && <div className="inline-alert"><LockKeyhole size={15} /> Login before reserving wallet balance.</div>}
      <button className="dispatch-button" onClick={hasEnoughBalance ? onConfirm : onOpenTopUp} disabled={busy === "confirm" || needsLogin}>
        {hasEnoughBalance ? "Dispatch Job" : "Top Up Required"} <ArrowRight size={18} />
      </button>
    </section>
  );
}

function AuthGate({
  authEmail,
  authMode,
  authPassword,
  busy,
  error,
  onAuthEmail,
  onAuthMode,
  onAuthPassword,
  onSubmit,
}: {
  authEmail: string;
  authMode: "login" | "signup";
  authPassword: string;
  busy: string | null;
  error: string | null;
  onAuthEmail: (value: string) => void;
  onAuthMode: (value: "login" | "signup") => void;
  onAuthPassword: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <section className="auth-gate">
      <div className="auth-gate-copy">
        <StatusChip tone="cyan" label="SECURE OPERATOR ACCESS" icon={<ShieldCheck size={14} />} />
        <h1>Login to launch your BlockMesh command console.</h1>
        <p>Create jobs, reserve wallet balance, track worker progress, and download sanitized reports from one controlled session.</p>
        <div className="auth-feature-strip">
          <span><LockKeyhole size={15} /> Wallet ledger</span>
          <span><Radar size={15} /> Worker monitor</span>
          <span><FileText size={15} /> Clean reports</span>
        </div>
      </div>

      <form onSubmit={onSubmit} className="auth-gate-form">
        <PanelTitle icon={<UserRound size={18} />} kicker="ACCOUNT" title={authMode === "login" ? "Login" : "Create Account"} />
        <div className="auth-tabs">
          <button type="button" className={authMode === "login" ? "active" : ""} onClick={() => onAuthMode("login")}>Login</button>
          <button type="button" className={authMode === "signup" ? "active" : ""} onClick={() => onAuthMode("signup")}>Sign Up</button>
        </div>
        <div className="auth-fields">
          <input value={authEmail} onChange={(event) => onAuthEmail(event.target.value)} placeholder="email@example.com" type="email" required />
          <input value={authPassword} onChange={(event) => onAuthPassword(event.target.value)} placeholder="Password" type="password" required minLength={6} />
        </div>
        {error && <div className="auth-error"><AlertTriangle size={15} /> {error}</div>}
        <button className="dispatch-button" disabled={busy === "auth"}>
          {authMode === "login" ? "Login" : "Create Account"} <ArrowRight size={18} />
        </button>
      </form>
    </section>
  );
}

function WorkerMonitor({
  busy,
  job,
  onCancel,
  onRefresh,
  progress,
}: {
  busy: string | null;
  job: JobSummary | null;
  onCancel: () => void;
  onRefresh: () => void;
  progress: number;
}) {
  const canCancel = Boolean(job && !["completed", "failed", "cancelled"].includes(job.status));
  return (
    <section className="console-panel monitor-panel">
      <PanelTitle icon={<Radar size={18} />} kicker="LIVE MONITOR" title="Worker State" />
      <div className="radar-wrap">
        <div className="radar">
          <span />
          <i />
        </div>
        <div>
          <strong>{job?.status || "Idle"}</strong>
          <span>{job ? `${job.workerStatus} / ${job.workerRegion}` : "No worker assigned"}</span>
        </div>
      </div>
      <div className="progress-shell">
        <div className="progress-meta">
          <span>{formatNumber(job?.directedPairs || 0)} pairs</span>
          <strong>{progress}%</strong>
        </div>
        <div className="pulse-progress"><span style={{ width: `${progress}%` }} /></div>
      </div>
      <div className="result-grid">
        <ResultTile tone="green" label="Blocked" value={job?.blocked || 0} />
        <ResultTile tone="gold" label="Already" value={job?.alreadyBlocked || 0} />
        <ResultTile tone="red" label="Failed" value={job?.failed || 0} />
        <ResultTile tone="cyan" label="Success" value={job ? `${job.successRate}%` : "0%"} />
      </div>
      <div className="monitor-actions">
        <button className="action-button secondary full" onClick={onRefresh} disabled={!job || busy === "job"}>
          <RefreshCcw size={17} /> Refresh
        </button>
        <button className="action-button danger full" onClick={onCancel} disabled={!canCancel || busy === "cancel"}>
          <X size={17} /> Cancel
        </button>
      </div>
    </section>
  );
}

function RecentJobsPanel({
  busy,
  jobs,
  onRefresh,
  onSelect,
  selectedJobId,
}: {
  busy: string | null;
  jobs: JobSummary[];
  onRefresh: () => void;
  onSelect: (job: JobSummary) => void;
  selectedJobId: string | null;
}) {
  return (
    <section className="console-panel recent-jobs-panel">
      <div className="report-toolbar">
        <PanelTitle icon={<BriefcaseBusinessIcon />} kicker="JOB HISTORY" title="Recent Jobs" />
        <button className="icon-button" onClick={onRefresh} disabled={busy === "jobs"} aria-label="Refresh jobs">
          <RefreshCcw size={16} />
        </button>
      </div>
      <div className="recent-job-list">
        {jobs.length === 0 ? (
          <div className="empty-state">No saved jobs yet.</div>
        ) : jobs.map((item) => (
          <button
            className={item.jobId === selectedJobId ? "recent-job active" : "recent-job"}
            key={item.jobId}
            onClick={() => onSelect(item)}
          >
            <span>{item.status}</span>
            <strong>{formatNumber(item.directedPairs)} pairs</strong>
            <em>{item.jobId.slice(0, 8)}</em>
          </button>
        ))}
      </div>
    </section>
  );
}

function BriefcaseBusinessIcon() {
  return <Database size={18} />;
}

function ActivityFeed({ events }: { events: ActivityEvent[] }) {
  return (
    <section className="console-panel activity-panel">
      <PanelTitle icon={<Activity size={18} />} kicker="SYSTEM FEED" title="Live Events" />
      <div className="event-stream">
        {events.map((event) => (
          <div className={`event-row ${event.tone}`} key={event.id}>
            <span>[{event.label}]</span>
            <p>{event.detail}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function RecentWalletActivity({ currentCostBaht, job, walletBalance, walletEvents }: { currentCostBaht: number; job: JobSummary | null; walletBalance: number; walletEvents: WalletEvent[] }) {
  return (
    <section className="console-panel ledger-panel">
      <PanelTitle icon={<WalletCards size={18} />} kicker="WALLET LEDGER" title="Reserve / Refund" />
      <div className="ledger-lines">
        <MetricLine label="Balance" value={formatBaht(walletBalance)} />
        <MetricLine label="Estimate" value={formatBaht(currentCostBaht)} />
        <MetricLine label="Charged" value={formatBaht(job?.chargedBaht || 0)} />
        <MetricLine label="Refunded" value={formatBaht(job?.refundedBaht || 0)} />
      </div>
      <div className="wallet-events">
        {walletEvents.length === 0 ? (
          <div className="empty-state">No wallet activity yet.</div>
        ) : walletEvents.slice(0, 5).map((event) => (
          <div key={event.id} className={`wallet-event ${event.type}`}>
            <span>{event.label}</span>
            <strong>{event.amountBaht >= 0 ? "+" : ""}{formatBaht(event.amountBaht)}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function ReportConsole({ busy, job, onLoadReport, report }: { busy: string | null; job: JobSummary | null; onLoadReport: () => void; report: Record<string, unknown> | null }) {
  return (
    <section className="console-panel report-panel">
      <PanelTitle icon={<FileText size={18} />} kicker="SANITIZED OUTPUT" title="Report Console" />
      <div className="report-toolbar">
        <StatusChip tone={report ? "green" : "gold"} icon={<CheckCircle2 size={14} />} label={report ? "loaded" : "pending"} />
        <button className="action-button secondary" onClick={onLoadReport} disabled={!job || busy === "report"}>
          <Download size={16} /> Load Report
        </button>
      </div>
      <pre className={report ? "report-box reveal" : "report-box"}>{report ? JSON.stringify(report, null, 2) : "No report loaded yet.\nReports never include cookies, passwords, or tokens."}</pre>
    </section>
  );
}

function TopUpDialog({
  busy,
  isOpen,
  lastTopUp,
  needsLogin,
  onClose,
  onPreview,
  onTopUp,
  onVoucher,
  paymentStatus,
  voucher,
  voucherUrl,
}: {
  busy: string | null;
  isOpen: boolean;
  lastTopUp: WalletTopUpResponse | null;
  needsLogin: boolean;
  onClose: () => void;
  onPreview: (event?: FormEvent) => void;
  onTopUp: () => void;
  onVoucher: (value: string) => void;
  paymentStatus: PaymentStatus | null;
  voucher: VoucherPreviewResponse | null;
  voucherUrl: string;
}) {
  if (!isOpen) return null;

  const selfTopUpDisabled = paymentStatus?.mode === "placeholder" && !paymentStatus.placeholderTopUpEnabled;

  return (
    <div className="dialog-backdrop">
      <section className="topup-dialog">
        <div className="dialog-header">
          <PanelTitle icon={<CreditCard size={18} />} kicker="WALLET NODE" title="Top Up Balance" />
          <button className="icon-button" onClick={onClose} aria-label="Close top up dialog"><X size={17} /></button>
        </div>
        {needsLogin && <div className="inline-alert"><LockKeyhole size={15} /> Login before topping up wallet.</div>}
        {selfTopUpDisabled && <div className="inline-alert"><AlertTriangle size={15} /> {paymentStatus.message}</div>}
        <form onSubmit={onPreview} className="topup-form">
          <input value={voucherUrl} onChange={(event) => onVoucher(event.target.value)} placeholder="https://gift.truemoney.com/campaign/?v=..." />
          <button className="action-button secondary" disabled={busy === "voucher" || needsLogin}>Preview</button>
        </form>
        {voucher && (
          <div className={voucher.validFormat ? "voucher-state ok" : "voucher-state bad"}>
            {voucher.message}<br />
            Estimated credit: {formatBaht(voucher.estimatedBalanceBaht)}
          </div>
        )}
        {lastTopUp && (
          <div className={lastTopUp.accepted ? "voucher-state ok" : "voucher-state bad"}>
            {lastTopUp.message}<br />
            Transaction: {lastTopUp.transactionId}
          </div>
        )}
        <button className="dispatch-button" onClick={onTopUp} disabled={busy === "topup" || !voucherUrl || needsLogin || selfTopUpDisabled}>
          {selfTopUpDisabled ? "Admin Adjustment Required" : "Confirm Top Up"} <ArrowRight size={18} />
        </button>
      </section>
    </div>
  );
}

function PanelTitle({ icon, kicker, title }: { icon: React.ReactNode; kicker: string; title: string }) {
  return (
    <div className="panel-title">
      <div className="panel-icon">{icon}</div>
      <div>
        <span>{kicker}</span>
        <h2>{title}</h2>
      </div>
    </div>
  );
}

function MetricLine({ label, value }: { label: string; value: string }) {
  return <div className="metric-line"><span>{label}</span><strong>{value}</strong></div>;
}

function ResultTile({ label, tone, value }: { label: string; tone: "cyan" | "green" | "gold" | "red"; value: number | string }) {
  return <div className={`result-tile ${tone}`}><span>{label}</span><strong>{typeof value === "number" ? formatNumber(value) : value}</strong></div>;
}
