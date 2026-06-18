type JsonRecord = Record<string, unknown>;

export type DispatchWorkerJobInput = {
  jobId: string;
  userId: string;
  mode: "balanced" | "stable";
  accountCount: number;
  directedPairs: number;
  pricePerPairBaht: number;
  accountText: string;
  callbackBaseUrl?: string;
};

export function hasWorkerApi(): boolean {
  return Boolean(process.env.WORKER_API_BASE);
}

export async function proxyWorkerJson<TResponse>(
  path: string,
  init: RequestInit = {},
  fallback: () => TResponse | Promise<TResponse>,
): Promise<TResponse> {
  const base = process.env.WORKER_API_BASE;
  if (!base) return fallback();

  const url = new URL(path, base);
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  if (process.env.WORKER_API_TOKEN) {
    headers.set("authorization", `Bearer ${process.env.WORKER_API_TOKEN}`);
  }

  const response = await fetch(url, {
    ...init,
    headers,
    cache: "no-store",
  });

  const data = (await response.json().catch(() => ({}))) as JsonRecord;
  if (!response.ok) {
    return {
      error: typeof data.error === "string" ? data.error : `Worker API HTTP ${response.status}`,
    } as TResponse;
  }
  return data as TResponse;
}

export function createMockJobId(prefix = "job"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
}

export async function dispatchWorkerJob(input: DispatchWorkerJobInput): Promise<{ queued: boolean; error?: string }> {
  if (!hasWorkerApi()) return { queued: false };

  const response = await proxyWorkerJson<{ queued?: boolean; accepted?: boolean; error?: string }>("/jobs", {
    method: "POST",
    body: JSON.stringify({
      jobId: input.jobId,
      userId: input.userId,
      mode: input.mode,
      accountCount: input.accountCount,
      directedPairs: input.directedPairs,
      pricePerPairBaht: input.pricePerPairBaht,
      accountText: input.accountText,
      callbackBase: input.callbackBaseUrl,
      callbackUrl: input.callbackBaseUrl ? `${input.callbackBaseUrl.replace(/\/$/, "")}/api/worker/jobs/${input.jobId}/complete` : undefined,
    }),
  }, () => ({ queued: false }));

  if (response.error) return { queued: false, error: response.error };
  return { queued: Boolean(response.queued || response.accepted) };
}

export function verifyWorkerToken(request: Request): boolean {
  const expected = process.env.WORKER_API_TOKEN;
  if (!expected) return false;
  const auth = request.headers.get("authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  return token === expected;
}
