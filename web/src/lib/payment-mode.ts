export function paymentProviderMode(): string {
  return process.env.PAYMENT_PROVIDER_MODE || "placeholder";
}

export function placeholderTopUpAllowed(): boolean {
  if (process.env.ALLOW_PLACEHOLDER_TOPUP === "1") return true;
  return process.env.NEXT_PUBLIC_APP_ENV !== "production";
}

export function placeholderTopUpDisabledMessage(): string {
  return "Self top-up is disabled until live TrueMoney verification is connected. Ask an admin to adjust wallet balance from the admin dashboard.";
}
