import { NextResponse } from "next/server";
import { liveTrueMoneyEnabled, paymentProviderMode, placeholderTopUpAllowed, placeholderTopUpDisabledMessage } from "@/lib/payment-mode";
import { isValidTrueMoneyVoucherUrl } from "@/lib/pricing";
import type { VoucherPreviewRequest, VoucherPreviewResponse } from "@/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Partial<VoucherPreviewRequest>;
  const voucherUrl = String(body.voucherUrl || "");
  const providerMode = paymentProviderMode();
  const validFormat = isValidTrueMoneyVoucherUrl(voucherUrl);
  const canSubmit = liveTrueMoneyEnabled() || (providerMode === "placeholder" && placeholderTopUpAllowed());

  return NextResponse.json({
    providerMode,
    validFormat,
    estimatedBalanceBaht: 0,
    message: !validFormat
      ? "Invalid TrueMoney voucher URL format."
      : canSubmit
        ? "Voucher format accepted. The exact amount will be confirmed by TrueMoney when redeemed."
        : placeholderTopUpDisabledMessage(),
  } satisfies VoucherPreviewResponse);
}
