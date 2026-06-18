import { NextResponse } from "next/server";
import { paymentProviderMode, placeholderTopUpAllowed, placeholderTopUpDisabledMessage } from "@/lib/payment-mode";
import { isValidTrueMoneyVoucherUrl } from "@/lib/pricing";
import { proxyWorkerJson } from "@/lib/worker-api";
import type { VoucherPreviewRequest, VoucherPreviewResponse } from "@/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Partial<VoucherPreviewRequest>;
  const voucherUrl = String(body.voucherUrl || "");
  const providerMode = paymentProviderMode();

  return NextResponse.json(
    await proxyWorkerJson<VoucherPreviewResponse>("/payments/voucher/preview", {
      method: "POST",
      body: JSON.stringify({ voucherUrl }),
    }, () => {
      const validFormat = isValidTrueMoneyVoucherUrl(voucherUrl);
      const canCredit = validFormat && (providerMode !== "placeholder" || placeholderTopUpAllowed());
      return {
        providerMode,
        validFormat,
        estimatedBalanceBaht: canCredit ? 1000 : 0,
        message: validFormat
          ? (canCredit
            ? "Voucher format accepted. Wallet top-up provider is ready to connect through server-side credentials."
            : placeholderTopUpDisabledMessage())
          : "Invalid TrueMoney voucher URL format.",
      };
    }),
  );
}
