export type BlockMeshMode = "balanced" | "stable";

export type QuoteRequest = {
  accountCount: number;
  mode?: BlockMeshMode;
  accountText?: string;
};

export type QuoteResponse = {
  accountCount: number;
  directedPairs: number;
  currency: "THB";
  pricePerPair: number;
  estimatedCostBaht: number;
  pricingTier: "standard" | "volume";
  volumeThresholdPairs: number;
  estimatedDurationMinutes: number;
  refundableStatuses: string[];
};

export type JobDraftRequest = {
  accountCount: number;
  mode: BlockMeshMode;
  note?: string;
  accountText?: string;
};

export type JobDraftResponse = {
  draftId: string;
  quote: QuoteResponse;
  expiresAt: string;
};

export type JobStatus = "draft" | "queued" | "running" | "retrying" | "completed" | "failed" | "cancelled";

export type JobSummary = {
  jobId: string;
  status: JobStatus;
  accountsUsed: number;
  directedPairs: number;
  blocked: number;
  alreadyBlocked: number;
  failed: number;
  successRate: number;
  reservedBaht: number;
  chargedBaht: number;
  refundedBaht: number;
  elapsedSeconds: number;
  etaSeconds: number;
  workerRegion: string;
  workerStatus: "mock" | "queued" | "connected" | "failed";
};

export type AdminOverview = {
  users: number;
  jobs: number;
  queuedJobs: number;
  runningJobs: number;
  completedJobs: number;
  failedJobs: number;
  walletBalanceTotalBaht: number;
  latestJobs: Array<{
    jobId: string;
    email: string | null;
    status: JobStatus;
    accountsUsed: number;
    directedPairs: number;
    reservedBaht: number;
    createdAt: string;
  }>;
};

export type AdminUserRow = {
  userId: string;
  email: string | null;
  role: "user" | "admin";
  balanceBaht: number;
  jobs: number;
  createdAt: string;
};

export type AdminAuditLogRow = {
  id: string;
  actorEmail: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type VoucherPreviewRequest = {
  voucherUrl: string;
};

export type VoucherPreviewResponse = {
  providerMode: string;
  validFormat: boolean;
  estimatedBalanceBaht: number;
  message: string;
};

export type WalletTopUpRequest = {
  voucherUrl: string;
};

export type WalletTopUpResponse = {
  providerMode: string;
  transactionId: string;
  accepted: boolean;
  creditedBaht: number;
  message: string;
};

export type PaymentStatus = {
  mode: string;
  liveTrueMoneyEnabled: boolean;
  placeholderTopUpEnabled: boolean;
  message: string;
};

export type WalletSnapshot = {
  authenticated: boolean;
  backend: "supabase" | "local";
  balanceBaht: number;
  events: Array<{
    id: string;
    type: "topup" | "reserve" | "capture" | "refund" | "manual_adjust";
    amountBaht: number;
    label: string;
    status: string;
    createdAt: string;
  }>;
};

export type SystemStatus = {
  appEnv: string;
  siteUrlConfigured: boolean;
  supabase: {
    configured: boolean;
    ok: boolean;
    detail: unknown;
  };
  worker: {
    configured: boolean;
    ok: boolean;
    detail: unknown;
  };
  workerDispatchConfigured: boolean;
  encryption: {
    configured: boolean;
    ok: boolean;
  };
  quota: {
    maxActiveJobsPerUser: number;
    ok: boolean;
  };
  payment: {
    mode: string;
    liveTrueMoneyEnabled: boolean;
    placeholderTopUpEnabled: boolean;
  };
  secretsPolicy: string;
};
