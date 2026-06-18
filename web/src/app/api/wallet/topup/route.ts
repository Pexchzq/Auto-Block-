import { NextResponse } from "next/server";
import { paymentProviderMode, placeholderTopUpAllowed, placeholderTopUpDisabledMessage } from "@/lib/payment-mode";
import { isValidTrueMoneyVoucherUrl } from "@/lib/pricing";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { createMockJobId, proxyWorkerJson } from "@/lib/worker-api";
import { getSupabaseAdmin, getUserIdFromRequest, hasSupabaseAdminConfig } from "@/lib/supabase-server";
import type { WalletTopUpRequest, WalletTopUpResponse } from "@/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const rateLimit = checkRateLimit(request, { key: "wallet:topup", limit: 10, windowMs: 60_000 });
  if (!rateLimit.ok) {
    const response = rateLimitResponse(rateLimit.retryAfterSeconds);
    return NextResponse.json(response.body, response.init);
  }

  const body = (await request.json().catch(() => ({}))) as Partial<WalletTopUpRequest>;
  const voucherUrl = String(body.voucherUrl || "");
  const validFormat = isValidTrueMoneyVoucherUrl(voucherUrl);
  const providerMode = paymentProviderMode();

  if (hasSupabaseAdminConfig()) {
    const admin = getSupabaseAdmin();
    const userId = await getUserIdFromRequest(request);
    if (!admin || !userId) {
      return NextResponse.json({ error: "Login is required before topping up wallet" }, { status: 401 });
    }

    if (!validFormat) {
      return NextResponse.json({
        providerMode,
        transactionId: "",
        accepted: false,
        creditedBaht: 0,
        message: "Invalid TrueMoney voucher URL format.",
      } satisfies WalletTopUpResponse);
    }

    if (providerMode === "placeholder" && !placeholderTopUpAllowed()) {
      return NextResponse.json({
        providerMode,
        transactionId: "",
        accepted: false,
        creditedBaht: 0,
        message: placeholderTopUpDisabledMessage(),
      } satisfies WalletTopUpResponse, { status: 403 });
    }

    const transactionId = createMockJobId("topup");
    const creditedBaht = 1000;
    const { error } = await admin.from("wallet_ledger").insert({
      user_id: userId,
      type: "topup",
      amount_baht: creditedBaht,
      label: "TrueMoney wallet top-up placeholder",
      provider: "truemoney",
      reference: transactionId,
      status: "posted",
      metadata: { mode: providerMode },
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      providerMode,
      transactionId,
      accepted: true,
      creditedBaht,
      message: "Wallet credited in Supabase placeholder mode. Live TrueMoney verification is still disabled.",
    } satisfies WalletTopUpResponse);
  }

  return NextResponse.json(
    await proxyWorkerJson<WalletTopUpResponse>("/wallet/topup", {
      method: "POST",
      body: JSON.stringify({ voucherUrl }),
    }, () => {
      return {
        providerMode: process.env.PAYMENT_PROVIDER_MODE || "placeholder",
        transactionId: createMockJobId("topup"),
        accepted: validFormat && placeholderTopUpAllowed(),
        creditedBaht: validFormat && placeholderTopUpAllowed() ? 1000 : 0,
        message: validFormat
          ? (placeholderTopUpAllowed()
            ? "Wallet credited in placeholder mode. Connect TRUEMONEY_API_* env vars through your payment worker for live redemption."
            : placeholderTopUpDisabledMessage())
          : "Invalid TrueMoney voucher URL format.",
      };
    }),
  );
}
