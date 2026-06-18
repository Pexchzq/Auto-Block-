import { NextResponse } from "next/server";

export const runtime = "nodejs";

type TrueMoneyWebhookPayload = {
  event?: string;
  amount?: number | string;
  transactionId?: string;
  referenceId?: string;
  sender?: string;
  timestamp?: string;
  [key: string]: unknown;
};

function sanitizePayload(payload: TrueMoneyWebhookPayload) {
  return {
    event: typeof payload.event === "string" ? payload.event : "payment.received",
    amount: payload.amount ?? null,
    transactionId: typeof payload.transactionId === "string" ? payload.transactionId : null,
    referenceId: typeof payload.referenceId === "string" ? payload.referenceId : null,
    timestamp: typeof payload.timestamp === "string" ? payload.timestamp : new Date().toISOString(),
  };
}

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as TrueMoneyWebhookPayload;
  const sanitized = sanitizePayload(payload);

  // Production note:
  // Verify provider signature here, then credit wallet ledger in your database.
  // Do not trust amount/reference fields until signature verification is implemented.
  return NextResponse.json({
    ok: true,
    received: sanitized,
    mode: process.env.PAYMENT_PROVIDER_MODE || "placeholder",
    message: "Webhook received. Signature verification and wallet crediting must be connected before live payments.",
  });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "/api/payments/truemoney/webhook",
    method: "POST",
    message: "Use the public HTTPS URL of this route as the TrueMoney endpoint URL.",
  });
}
