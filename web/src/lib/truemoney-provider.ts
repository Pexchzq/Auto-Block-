import { createHash } from "node:crypto";
import { isValidTrueMoneyVoucherUrl } from "./pricing.ts";

type UnknownRecord = Record<string, unknown>;

export type TrueMoneyRedeemResult = {
  accepted: true;
  amountBaht: number;
  transactionId: string;
  providerStatus: string;
};

export class TrueMoneyProviderError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(
    message: string,
    status = 502,
    code = "provider_error",
  ) {
    super(message);
    this.name = "TrueMoneyProviderError";
    this.status = status;
    this.code = code;
  }
}

function asRecord(value: unknown): UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function firstNumber(...values: unknown[]): number {
  for (const value of values) {
    const parsed = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Number.NaN;
}

function safeProviderMessage(value: string): string {
  return value
    .replace(/https?:\/\/\S+/gi, "[REDACTED_URL]")
    .replace(/([?&]v=)[^&\s]+/gi, "$1[REDACTED]")
    .slice(0, 240);
}

function providerEndpoint(): URL {
  const baseValue = String(process.env.TRUEMONEY_API_BASE || "").trim();
  if (!baseValue) throw new TrueMoneyProviderError("TrueMoney provider is not configured", 503, "not_configured");

  const base = new URL(baseValue.endsWith("/") ? baseValue : `${baseValue}/`);
  const local = ["127.0.0.1", "localhost"].includes(base.hostname);
  if (base.protocol !== "https:" && !(local && process.env.NODE_ENV !== "production")) {
    throw new TrueMoneyProviderError("TrueMoney provider must use HTTPS", 503, "insecure_provider_url");
  }

  const path = String(process.env.TRUEMONEY_REDEEM_PATH || "v1/vouchers/redeem").replace(/^\/+/, "");
  return new URL(path, base);
}

export function trueMoneyProviderConfigured(): boolean {
  return Boolean(
    String(process.env.TRUEMONEY_API_BASE || "").trim()
    && String(process.env.TRUEMONEY_API_TOKEN || "").trim(),
  );
}

export function trueMoneyVoucherReference(voucherUrl: string): {
  reference: string;
  rawHash: string;
} {
  if (!isValidTrueMoneyVoucherUrl(voucherUrl)) {
    throw new TrueMoneyProviderError("Invalid TrueMoney voucher URL format", 400, "invalid_voucher_url");
  }

  const voucherCode = new URL(voucherUrl).searchParams.get("v")?.trim() || "";
  const rawHash = createHash("sha256").update(voucherCode, "utf8").digest("hex");
  return {
    reference: `voucher:${rawHash}`,
    rawHash,
  };
}

export function parseTrueMoneyProviderResponse(payload: unknown): TrueMoneyRedeemResult {
  const root = asRecord(payload);
  const data = asRecord(root.data);
  const success = root.success === true
    || root.accepted === true
    || data.success === true
    || data.accepted === true;
  const providerStatus = firstString(root.status, data.status, success ? "redeemed" : "");
  const accepted = success || ["success", "succeeded", "redeemed", "completed", "paid"].includes(providerStatus.toLowerCase());
  const amountBaht = firstNumber(
    root.amountBaht,
    root.amount_baht,
    root.amount,
    data.amountBaht,
    data.amount_baht,
    data.amount,
  );
  const transactionId = firstString(
    root.transactionId,
    root.transaction_id,
    root.referenceId,
    root.reference_id,
    data.transactionId,
    data.transaction_id,
    data.referenceId,
    data.reference_id,
  );

  if (!accepted) {
    const message = firstString(root.message, data.message, "TrueMoney voucher was not accepted");
    const code = firstString(root.code, data.code, "voucher_rejected");
    throw new TrueMoneyProviderError(safeProviderMessage(message), 422, code.slice(0, 80));
  }

  const maxAmount = Math.max(1, Number(process.env.TRUEMONEY_MAX_TOPUP_BAHT || 100_000));
  if (!Number.isFinite(amountBaht) || amountBaht <= 0 || amountBaht > maxAmount) {
    throw new TrueMoneyProviderError("Provider returned an invalid voucher amount", 502, "invalid_provider_amount");
  }
  if (!transactionId) {
    throw new TrueMoneyProviderError("Provider response is missing a transaction id", 502, "missing_transaction_id");
  }

  return {
    accepted: true,
    amountBaht: Math.round(amountBaht * 100) / 100,
    transactionId: transactionId.slice(0, 200),
    providerStatus: providerStatus.slice(0, 80) || "redeemed",
  };
}

export async function redeemTrueMoneyVoucher(
  voucherUrl: string,
  reference: string,
): Promise<TrueMoneyRedeemResult> {
  if (!trueMoneyProviderConfigured()) {
    throw new TrueMoneyProviderError("TrueMoney provider credentials are missing", 503, "not_configured");
  }

  const timeoutMs = Math.min(60_000, Math.max(3_000, Number(process.env.TRUEMONEY_TIMEOUT_MS || 20_000)));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(providerEndpoint(), {
      method: "POST",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "accept": "application/json",
        "authorization": `Bearer ${String(process.env.TRUEMONEY_API_TOKEN || "").trim()}`,
        "idempotency-key": reference,
      },
      body: JSON.stringify({ voucherUrl, reference }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const body = asRecord(payload);
      const data = asRecord(body.data);
      const message = firstString(body.message, data.message, `TrueMoney provider returned HTTP ${response.status}`);
      const code = firstString(body.code, data.code, `provider_http_${response.status}`);
      throw new TrueMoneyProviderError(safeProviderMessage(message), response.status >= 500 ? 502 : 422, code.slice(0, 80));
    }
    return parseTrueMoneyProviderResponse(payload);
  } catch (error) {
    if (error instanceof TrueMoneyProviderError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new TrueMoneyProviderError("TrueMoney provider timed out", 504, "provider_timeout");
    }
    throw new TrueMoneyProviderError("TrueMoney provider request failed", 502, "provider_network_error");
  } finally {
    clearTimeout(timer);
  }
}
