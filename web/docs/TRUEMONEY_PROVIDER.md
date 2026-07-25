# TrueMoney Voucher Provider Contract

BlockMesh never redeems a voucher in the browser or Discord process. Both clients send the
voucher URL to the Next.js server, which hashes the voucher code and forwards it to a
server-side provider.

## Direct Angpao Mode

For the bundled direct adapter:

```env
PAYMENT_PROVIDER_MODE=angpao
ANGPAO_PHONE=0xxxxxxxxx
ALLOW_PLACEHOLDER_TOPUP=0
```

`ANGPAO_PHONE` is the wallet receiving number. Keep it server-side and never prefix it with
`NEXT_PUBLIC_`. In this mode, `TRUEMONEY_API_BASE` and `TRUEMONEY_API_TOKEN` are not used.
The website and Discord bot continue to call the same wallet top-up API, so voucher
deduplication and wallet-ledger crediting remain centralized in Supabase.

The direct gift-voucher endpoint is not an official public TrueMoney API and can change or
be blocked without notice. Keep the external provider mode below as a migration path.

## External Provider Mode

Use these settings when redemption is handled by a separate approved provider:

```env
PAYMENT_PROVIDER_MODE=truemoney
TRUEMONEY_API_BASE=https://provider.example/
TRUEMONEY_API_TOKEN=replace-with-provider-token
```

## Redeem Request

```http
POST /v1/vouchers/redeem
Authorization: Bearer <TRUEMONEY_API_TOKEN>
Idempotency-Key: voucher:<sha256-of-voucher-code>
Content-Type: application/json
```

```json
{
  "voucherUrl": "https://gift.truemoney.com/campaign/?v=...",
  "reference": "voucher:<sha256-of-voucher-code>"
}
```

The provider must treat `Idempotency-Key` as a permanent redemption key. Repeating the same
request must return the original result and must not redeem or credit the voucher twice.

## Redeem Response

```json
{
  "accepted": true,
  "status": "redeemed",
  "amountBaht": 100,
  "transactionId": "provider-transaction-id"
}
```

`success` may be used instead of `accepted`, `amount` instead of `amountBaht`, and
`referenceId` instead of `transactionId`. The server rejects missing IDs, zero/negative
amounts, and amounts above `TRUEMONEY_MAX_TOPUP_BAHT`.

## Asynchronous Callback

```http
POST /api/payments/truemoney/webhook
Authorization: Bearer <TRUEMONEY_WEBHOOK_SECRET>
Content-Type: application/json
```

```json
{
  "event": "voucher.redeemed",
  "status": "redeemed",
  "amountBaht": 100,
  "transactionId": "provider-transaction-id",
  "referenceId": "voucher:<sha256-of-voucher-code>"
}
```

The callback never accepts a user ID. It resolves the wallet from the pre-registered hashed
reference, and the database's unique ledger reference prevents duplicate credits.

## Data Handling

- Raw voucher URLs are sent only to the configured provider.
- Raw voucher URLs are not stored in Supabase, reports, audit logs, or Discord messages.
- Supabase stores only a SHA-256 reference, amount, status, and provider transaction ID.
- Provider errors returned to users must not include authorization headers or raw request data.

## Official API Boundary

TrueMoney publicly documents business APIs for incoming-payment notifications, transaction
verification, balance checks, and payment links. It does not publish a gift-envelope
redemption contract. Use an approved provider for this adapter. For a fully official
integration, replace voucher entry with TrueMoney payment links and reconcile the payment
through the official incoming-payment webhook.
