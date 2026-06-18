import type { BlockMeshMode, QuoteResponse } from "@/types";

export const VOLUME_THRESHOLD_PAIRS = 50000;
export const STANDARD_PRICE_PER_PAIR_BAHT = 0.01;
export const VOLUME_PRICE_PER_PAIR_BAHT = 0.005;
export const DEFAULT_MAX_ACTIVE_JOBS_PER_USER = 2;

export function maxActiveJobsPerUser(): number {
  const configured = Number(process.env.MAX_ACTIVE_JOBS_PER_USER || DEFAULT_MAX_ACTIVE_JOBS_PER_USER);
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : DEFAULT_MAX_ACTIVE_JOBS_PER_USER;
}

export function getPricePerPairBaht(directedPairs: number): number {
  return directedPairs > VOLUME_THRESHOLD_PAIRS
    ? VOLUME_PRICE_PER_PAIR_BAHT
    : STANDARD_PRICE_PER_PAIR_BAHT;
}

export function roundBaht(value: number): number {
  return Math.round(value * 100) / 100;
}

export function getDirectedPairs(accountCount: number): number {
  const normalized = Math.max(0, Math.floor(accountCount));
  return normalized > 1 ? normalized * (normalized - 1) : 0;
}

export function estimateDurationMinutes(accountCount: number, mode: BlockMeshMode = "balanced"): number {
  const pairs = getDirectedPairs(accountCount);
  const pairsPerMinute = mode === "stable" ? 130 : 180;
  return pairs === 0 ? 0 : Math.ceil((pairs / pairsPerMinute) * 10) / 10;
}

export function createQuote(accountCount: number, mode: BlockMeshMode = "balanced"): QuoteResponse {
  const normalized = Math.max(0, Math.floor(accountCount));
  const directedPairs = getDirectedPairs(normalized);
  const pricePerPair = getPricePerPairBaht(directedPairs);

  return {
    accountCount: normalized,
    directedPairs,
    currency: "THB",
    pricePerPair,
    estimatedCostBaht: roundBaht(directedPairs * pricePerPair),
    pricingTier: directedPairs > VOLUME_THRESHOLD_PAIRS ? "volume" : "standard",
    volumeThresholdPairs: VOLUME_THRESHOLD_PAIRS,
    estimatedDurationMinutes: estimateDurationMinutes(normalized, mode),
    refundableStatuses: ["failed_final", "skipped_missing_source_cookie", "invalid_account"],
  };
}

export function isValidTrueMoneyVoucherUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return (
      ["http:", "https:"].includes(url.protocol) &&
      /(^|\.)gift\.truemoney\.com$/i.test(url.hostname) &&
      url.pathname.toLowerCase().includes("/campaign/")
    );
  } catch {
    return false;
  }
}
