import { NextResponse } from "next/server";
import { paymentProviderMode, placeholderTopUpAllowed, placeholderTopUpDisabledMessage } from "@/lib/payment-mode";
import type { PaymentStatus } from "@/types";

export const runtime = "nodejs";

export async function GET() {
  const mode = paymentProviderMode();
  const placeholderEnabled = placeholderTopUpAllowed();

  return NextResponse.json({
    mode,
    liveTrueMoneyEnabled: false,
    placeholderTopUpEnabled: placeholderEnabled,
    message: mode === "placeholder" && !placeholderEnabled
      ? placeholderTopUpDisabledMessage()
      : "Payment placeholder is enabled for local/demo testing.",
  } satisfies PaymentStatus);
}
