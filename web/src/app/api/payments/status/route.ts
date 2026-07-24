import { NextResponse } from "next/server";
import { liveTrueMoneyEnabled, paymentProviderMode, placeholderTopUpAllowed, placeholderTopUpDisabledMessage } from "@/lib/payment-mode";
import type { PaymentStatus } from "@/types";

export const runtime = "nodejs";

export async function GET() {
  const mode = paymentProviderMode();
  const placeholderEnabled = placeholderTopUpAllowed();
  const liveEnabled = liveTrueMoneyEnabled();

  return NextResponse.json({
    mode,
    liveTrueMoneyEnabled: liveEnabled,
    placeholderTopUpEnabled: placeholderEnabled,
    message: liveEnabled
      ? "TrueMoney voucher verification is connected."
      : mode === "placeholder" && placeholderEnabled
        ? "Payment placeholder is enabled for local/demo testing."
        : placeholderTopUpDisabledMessage(),
  } satisfies PaymentStatus);
}
