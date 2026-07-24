import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export const runtime = "nodejs";

type TrueMoneyWebhookPayload = {
  event?: string;
  status?: string;
  amount?: number | string;
  amountBaht?: number | string;
  transactionId?: string;
  referenceId?: string;
  timestamp?: string;
};

function safeEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function verifyWebhook(request: Request): boolean {
  const expected = String(process.env.TRUEMONEY_WEBHOOK_SECRET || "").trim();
  const authorization = request.headers.get("authorization") || "";
  const bearer = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : "";
  const headerSecret = request.headers.get("x-blockmesh-webhook-secret") || "";
  const actual = bearer || headerSecret;
  return Boolean(expected && actual && safeEqual(actual, expected));
}

function validSuccessEvent(event: string, status: string): boolean {
  return [
    "payment.received",
    "payment.succeeded",
    "voucher.redeemed",
    "topup.succeeded",
  ].includes(event.toLowerCase()) || [
    "paid",
    "posted",
    "received",
    "redeemed",
    "succeeded",
    "success",
  ].includes(status.toLowerCase());
}

export async function POST(request: Request) {
  if (!verifyWebhook(request)) {
    return NextResponse.json({ error: "Webhook authorization failed" }, { status: 401 });
  }

  const payload = (await request.json().catch(() => ({}))) as TrueMoneyWebhookPayload;
  const event = String(payload.event || "").slice(0, 80);
  const status = String(payload.status || "").slice(0, 80);
  const reference = String(payload.referenceId || "").trim();
  const transactionId = String(payload.transactionId || "").trim().slice(0, 200);
  const amountBaht = Math.round(Number(payload.amountBaht ?? payload.amount) * 100) / 100;
  const maxAmount = Math.max(1, Number(process.env.TRUEMONEY_MAX_TOPUP_BAHT || 100_000));

  if (!validSuccessEvent(event, status)) {
    return NextResponse.json({ error: "Webhook event is not a successful payment" }, { status: 422 });
  }
  if (!/^voucher:[a-f0-9]{64}$/.test(reference)) {
    return NextResponse.json({ error: "Webhook reference is invalid" }, { status: 400 });
  }
  if (!transactionId || !Number.isFinite(amountBaht) || amountBaht <= 0 || amountBaht > maxAmount) {
    return NextResponse.json({ error: "Webhook transaction or amount is invalid" }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "Supabase admin env is required" }, { status: 503 });

  const { data: voucher, error: voucherReadError } = await admin
    .from("payment_vouchers")
    .select("user_id,status")
    .eq("provider", "truemoney")
    .eq("reference", reference)
    .maybeSingle();
  if (voucherReadError) return NextResponse.json({ error: "Voucher lookup failed" }, { status: 500 });
  if (!voucher?.user_id) return NextResponse.json({ error: "Payment reference was not registered" }, { status: 404 });

  const { error: ledgerError } = await admin.from("wallet_ledger").insert({
    user_id: voucher.user_id,
    type: "topup",
    amount_baht: amountBaht,
    label: "TrueMoney voucher top-up",
    provider: "truemoney",
    reference,
    status: "posted",
    metadata: { transactionId, event, providerStatus: status || "received" },
  });
  if (ledgerError && ledgerError.code !== "23505") {
    return NextResponse.json({ error: "Wallet ledger write failed" }, { status: 500 });
  }

  const duplicate = ledgerError?.code === "23505";
  const { error: voucherUpdateError } = await admin
    .from("payment_vouchers")
    .update({ amount_baht: amountBaht, status: "posted" })
    .eq("provider", "truemoney")
    .eq("reference", reference);
  if (voucherUpdateError) {
    return NextResponse.json({ error: "Voucher status update failed" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    duplicate,
    reference,
    creditedBaht: duplicate ? 0 : amountBaht,
  });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "/api/payments/truemoney/webhook",
    authentication: "Bearer TRUEMONEY_WEBHOOK_SECRET",
    mode: process.env.PAYMENT_PROVIDER_MODE || "placeholder",
  });
}
