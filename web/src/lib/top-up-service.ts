import type { SupabaseClient } from "@supabase/supabase-js";
import { paymentProviderMode, placeholderTopUpAllowed, placeholderTopUpDisabledMessage } from "@/lib/payment-mode";
import { isValidTrueMoneyVoucherUrl } from "@/lib/pricing";
import {
  redeemTrueMoneyVoucher,
  trueMoneyProviderConfigured,
  TrueMoneyProviderError,
  trueMoneyVoucherReference,
} from "@/lib/truemoney-provider";
import type { WalletTopUpResponse } from "@/types";

export class TopUpServiceError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(
    status: number,
    message: string,
    code = "topup_error",
  ) {
    super(message);
    this.name = "TopUpServiceError";
    this.status = status;
    this.code = code;
  }
}

type VoucherRow = {
  user_id: string;
  status: string;
  amount_baht: number | null;
};

function response(
  providerMode: string,
  accepted: boolean,
  transactionId: string,
  creditedBaht: number,
  message: string,
): WalletTopUpResponse {
  return { providerMode, accepted, transactionId, creditedBaht, message };
}

async function creditPlaceholder(
  admin: SupabaseClient,
  userId: string,
  reference: string,
  rawHash: string,
): Promise<WalletTopUpResponse> {
  const amountBaht = 1_000;
  const { error } = await admin.from("wallet_ledger").insert({
    user_id: userId,
    type: "topup",
    amount_baht: amountBaht,
    label: "TrueMoney test top-up",
    provider: "truemoney-test",
    reference,
    status: "posted",
    metadata: { mode: "placeholder" },
  });
  if (error) {
    if (error.code === "23505") {
      return response("placeholder", false, reference, 0, "This test voucher was already credited.");
    }
    throw new TopUpServiceError(500, "Unable to write wallet ledger", "ledger_write_failed");
  }
  await admin.from("payment_vouchers").upsert({
    user_id: userId,
    provider: "truemoney-test",
    reference,
    amount_baht: amountBaht,
    status: "posted",
    raw_hash: rawHash,
  }, { onConflict: "provider,reference" });
  return response("placeholder", true, reference, amountBaht, "Test wallet credit completed.");
}

export async function topUpWalletWithVoucher(input: {
  admin: SupabaseClient;
  userId: string;
  voucherUrl: string;
}): Promise<WalletTopUpResponse> {
  const voucherUrl = String(input.voucherUrl || "").trim();
  const mode = paymentProviderMode();
  if (!isValidTrueMoneyVoucherUrl(voucherUrl)) {
    throw new TopUpServiceError(400, "Invalid TrueMoney voucher URL format", "invalid_voucher_url");
  }

  const { reference, rawHash } = trueMoneyVoucherReference(voucherUrl);
  if (mode === "placeholder") {
    if (!placeholderTopUpAllowed()) {
      throw new TopUpServiceError(403, placeholderTopUpDisabledMessage(), "placeholder_disabled");
    }
    return creditPlaceholder(input.admin, input.userId, reference, rawHash);
  }
  if (!["truemoney", "live", "angpao"].includes(mode) || !trueMoneyProviderConfigured()) {
    throw new TopUpServiceError(503, "TrueMoney live provider is not configured", "provider_not_configured");
  }

  const { data: existing, error: existingError } = await input.admin
    .from("payment_vouchers")
    .select("user_id,status,amount_baht")
    .eq("provider", "truemoney")
    .eq("reference", reference)
    .maybeSingle();
  if (existingError) throw new TopUpServiceError(500, "Unable to check voucher status", "voucher_lookup_failed");

  const existingVoucher = existing as VoucherRow | null;
  if (existingVoucher?.status === "posted") {
    return response(mode, false, reference, 0, "This TrueMoney voucher was already credited.");
  }
  if (existingVoucher && existingVoucher.user_id !== input.userId) {
    throw new TopUpServiceError(409, "This TrueMoney voucher was already submitted.", "voucher_duplicate");
  }

  if (!existingVoucher) {
    const { error: reserveError } = await input.admin.from("payment_vouchers").insert({
      user_id: input.userId,
      provider: "truemoney",
      reference,
      amount_baht: null,
      status: "preview",
      raw_hash: rawHash,
    });
    if (reserveError?.code === "23505") {
      throw new TopUpServiceError(409, "This TrueMoney voucher is already being processed.", "voucher_processing");
    }
    if (reserveError) throw new TopUpServiceError(500, "Unable to reserve voucher", "voucher_reserve_failed");
  } else {
    await input.admin
      .from("payment_vouchers")
      .update({ status: "preview" })
      .eq("provider", "truemoney")
      .eq("reference", reference)
      .eq("user_id", input.userId);
  }

  try {
    const redeemed = await redeemTrueMoneyVoucher(voucherUrl, reference);
    const { error: ledgerError } = await input.admin.from("wallet_ledger").insert({
      user_id: input.userId,
      type: "topup",
      amount_baht: redeemed.amountBaht,
      label: "TrueMoney voucher top-up",
      provider: "truemoney",
      reference,
      status: "posted",
      metadata: {
        transactionId: redeemed.transactionId,
        providerStatus: redeemed.providerStatus,
      },
    });

    if (ledgerError && ledgerError.code !== "23505") {
      throw new TopUpServiceError(500, "Voucher redeemed but wallet ledger write failed; contact an admin.", "ledger_write_failed");
    }
    if (ledgerError?.code === "23505") {
      await input.admin
        .from("payment_vouchers")
        .update({ status: "duplicate" })
        .eq("provider", "truemoney")
        .eq("reference", reference);
      return response(mode, false, redeemed.transactionId, 0, "This TrueMoney voucher was already credited.");
    }

    const { error: voucherError } = await input.admin
      .from("payment_vouchers")
      .update({ amount_baht: redeemed.amountBaht, status: "posted" })
      .eq("provider", "truemoney")
      .eq("reference", reference)
      .eq("user_id", input.userId);
    if (voucherError) {
      throw new TopUpServiceError(500, "Wallet credited but voucher status update failed; contact an admin.", "voucher_update_failed");
    }

    await input.admin.from("audit_logs").insert({
      actor_user_id: input.userId,
      action: "wallet.topup.truemoney",
      target_type: "payment_voucher",
      target_id: reference,
      metadata: { amountBaht: redeemed.amountBaht, transactionId: redeemed.transactionId },
    });

    return response(
      mode,
      true,
      redeemed.transactionId,
      redeemed.amountBaht,
      `TrueMoney voucher credited: ${redeemed.amountBaht.toFixed(2)} baht.`,
    );
  } catch (error) {
    await input.admin
      .from("payment_vouchers")
      .update({ status: "failed" })
      .eq("provider", "truemoney")
      .eq("reference", reference)
      .eq("user_id", input.userId);
    if (error instanceof TopUpServiceError) throw error;
    if (error instanceof TrueMoneyProviderError) {
      throw new TopUpServiceError(error.status, error.message, error.code);
    }
    throw new TopUpServiceError(502, "TrueMoney voucher redemption failed", "redemption_failed");
  }
}
