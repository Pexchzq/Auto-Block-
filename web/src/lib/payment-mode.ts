export function paymentProviderMode(): string {
  return process.env.PAYMENT_PROVIDER_MODE || "placeholder";
}

export function liveTrueMoneyEnabled(): boolean {
  return ["truemoney", "live"].includes(paymentProviderMode())
    && Boolean(
      String(process.env.TRUEMONEY_API_BASE || "").trim()
      && String(process.env.TRUEMONEY_API_TOKEN || "").trim(),
    );
}

export function placeholderTopUpAllowed(): boolean {
  if (process.env.ALLOW_PLACEHOLDER_TOPUP === "1") return true;
  return process.env.NEXT_PUBLIC_APP_ENV !== "production";
}

export function placeholderTopUpDisabledMessage(): string {
  return "TrueMoney top-up is not active yet. Configure the live payment provider or ask an admin to adjust the wallet.";
}
