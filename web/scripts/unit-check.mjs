import assert from "node:assert/strict";
import { createServer } from "node:http";

const accounts = await import("../src/lib/accounts.ts");
const payment = await import("../src/lib/payment-mode.ts");
const pairResults = await import("../src/lib/pair-results.ts");
const pricing = await import("../src/lib/pricing.ts");
const rateLimit = await import("../src/lib/rate-limit.ts");
const sanitizer = await import("../src/lib/report-sanitizer.ts");
const trueMoney = await import("../src/lib/truemoney-provider.ts");

const sampleAccounts = [
  "# ignored",
  "alpha:pass:_|WARNING:-DO-NOT-SHARE-THIS.alpha",
  "",
  "beta:pass:_|WARNING:-DO-NOT-SHARE-THIS.beta",
].join("\n");

assert.equal(accounts.countAccountLines(sampleAccounts), 2, "countAccountLines should ignore blank/comment lines");
assert.equal(accounts.resolveAccountCount({ accountCount: 999, accountText: sampleAccounts }), 2, "accountText must override manual count");

const valid = accounts.validateAccountInput(sampleAccounts, { required: true });
assert.equal(valid.ok, true, "valid account text should pass validation");
assert.equal(valid.count, 2, "valid account count should be 2");

const invalid = accounts.validateAccountInput("bad-line\nuser:pass:not-a-cookie", { required: true });
assert.equal(invalid.ok, false, "invalid account text should fail");
assert.deepEqual(invalid.invalidLines, [1, 2], "invalid lines should be reported without echoing secrets");

const colonPassword = accounts.validateAccountInput("user:pass:with-colon:_|WARNING:-DO-NOT-SHARE-THIS", { required: true });
assert.equal(colonPassword.ok, true, "cookie is anchored on _|WARNING so extra colons before it are accepted");

const noPassword = accounts.validateAccountInput("crystalmoose7266:_|WARNING:-DO-NOT-SHARE-THIS", { required: true });
assert.equal(noPassword.ok, true, "username:cookie (no password) should be accepted");

const rawCookie = accounts.validateAccountInput("_|WARNING:-DO-NOT-SHARE-THIS", { required: true });
assert.equal(rawCookie.ok, true, "a raw cookie with no metadata prefix should be accepted");

const tripleForm = accounts.validateAccountInput("crystalmoose7266:FQQMNZ8TP3FG:_|WARNING:-DO-NOT-SHARE-THIS", { required: true });
assert.equal(tripleForm.ok, true, "username:password:cookie triple should be accepted");

assert.equal(pricing.getDirectedPairs(10), 90, "10 accounts should produce 90 directed pairs");
assert.equal(pricing.getDirectedPairs(80), 6320, "80 accounts should produce 6320 directed pairs");
assert.equal(pricing.getDirectedPairs(220), 48180, "220 accounts should produce 48180 directed pairs");
assert.equal(pricing.getDirectedPairs(500), 249500, "500 accounts should produce 249500 directed pairs");
assert.equal(pricing.createQuote(500).pricingTier, "volume", "500 account quote should use volume pricing");
assert.equal(pricing.roundBaht(1.005), 1, "roundBaht should preserve existing Math.round behavior");

assert.deepEqual(pairResults.normalizeFinalPairResults({
  directedPairs: 2,
  blocked: 0,
  alreadyBlocked: 0,
  failed: 0,
}), {
  directedPairs: 2,
  blocked: 0,
  alreadyBlocked: 0,
  failed: 2,
  reportedFailed: 0,
  unaccountedPairs: 2,
}, "unreported final pairs must become failed and refundable");

assert.deepEqual(pairResults.normalizeFinalPairResults({
  directedPairs: 2,
  blocked: 1,
  alreadyBlocked: 3,
  failed: 9,
}), {
  directedPairs: 2,
  blocked: 1,
  alreadyBlocked: 1,
  failed: 0,
  reportedFailed: 0,
  unaccountedPairs: 0,
}, "worker counters must never exceed the quoted pair count");

assert.equal(pricing.isValidTrueMoneyVoucherUrl("https://gift.truemoney.com/campaign/?v=abc"), true, "valid TrueMoney voucher URL should pass format check");
assert.equal(pricing.isValidTrueMoneyVoucherUrl("https://example.com/campaign/?v=abc"), false, "non-TrueMoney URL should fail format check");
const voucherIdentity = trueMoney.trueMoneyVoucherReference("https://gift.truemoney.com/campaign/?v=secret-code");
assert.match(voucherIdentity.reference, /^voucher:[a-f0-9]{64}$/, "voucher reference must contain only a one-way hash");
assert.equal(voucherIdentity.reference.includes("secret-code"), false, "voucher reference must not expose the voucher code");
assert.deepEqual(trueMoney.parseTrueMoneyProviderResponse({
  success: true,
  amount: "125.50",
  referenceId: "transaction-1",
}), {
  accepted: true,
  amountBaht: 125.5,
  transactionId: "transaction-1",
  providerStatus: "redeemed",
}, "provider response should normalize verified amount and reference");

const originalProviderBase = process.env.TRUEMONEY_API_BASE;
const originalProviderToken = process.env.TRUEMONEY_API_TOKEN;
const providerRequests = [];
const providerServer = createServer((request, response) => {
  let body = "";
  request.setEncoding("utf8");
  request.on("data", (chunk) => { body += chunk; });
  request.on("end", () => {
    providerRequests.push({
      authorization: request.headers.authorization,
      idempotencyKey: request.headers["idempotency-key"],
      body: JSON.parse(body),
    });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ accepted: true, amountBaht: 75, transactionId: "mock-transaction" }));
  });
});
await new Promise((resolve) => providerServer.listen(0, "127.0.0.1", resolve));
const providerAddress = providerServer.address();
process.env.TRUEMONEY_API_BASE = `http://127.0.0.1:${providerAddress.port}/`;
process.env.TRUEMONEY_API_TOKEN = "unit-provider-token";
const redeemed = await trueMoney.redeemTrueMoneyVoucher(
  "https://gift.truemoney.com/campaign/?v=unit-voucher",
  "voucher:unit-reference",
);
await new Promise((resolve) => providerServer.close(resolve));
assert.equal(redeemed.amountBaht, 75, "provider client should return the verified amount");
assert.equal(providerRequests[0].authorization, "Bearer unit-provider-token", "provider client must authenticate server-side");
assert.equal(providerRequests[0].idempotencyKey, "voucher:unit-reference", "provider client must send the idempotency key");
assert.equal(providerRequests[0].body.reference, "voucher:unit-reference", "provider body must contain the same reference");
if (originalProviderBase === undefined) delete process.env.TRUEMONEY_API_BASE;
else process.env.TRUEMONEY_API_BASE = originalProviderBase;
if (originalProviderToken === undefined) delete process.env.TRUEMONEY_API_TOKEN;
else process.env.TRUEMONEY_API_TOKEN = originalProviderToken;

const sanitized = sanitizer.sanitizeReportValue({
  cookie: "_|WARNING:-DO-NOT-SHARE",
  nested: {
    csrfToken: "csrf",
    safeValue: "visible",
    array: [{ authorization: "Bearer token", ok: true }],
  },
});

assert.equal(sanitized.cookie, "[REDACTED]", "top-level cookie should be redacted");
assert.equal(sanitized.nested.csrfToken, "[REDACTED]", "nested CSRF token should be redacted");
assert.equal(sanitized.nested.safeValue, "visible", "safe nested value should remain visible");
assert.equal(sanitized.nested.array[0].authorization, "[REDACTED]", "array object authorization should be redacted");
assert.equal(sanitized.nested.array[0].ok, true, "safe array object value should remain visible");

const originalAppEnv = process.env.NEXT_PUBLIC_APP_ENV;
const originalAllowTopUp = process.env.ALLOW_PLACEHOLDER_TOPUP;
process.env.NEXT_PUBLIC_APP_ENV = "production";
delete process.env.ALLOW_PLACEHOLDER_TOPUP;
assert.equal(payment.placeholderTopUpAllowed(), false, "placeholder top-up should be disabled in production by default");
process.env.ALLOW_PLACEHOLDER_TOPUP = "1";
assert.equal(payment.placeholderTopUpAllowed(), true, "explicit override should enable placeholder top-up for controlled tests");
if (originalAppEnv === undefined) delete process.env.NEXT_PUBLIC_APP_ENV;
else process.env.NEXT_PUBLIC_APP_ENV = originalAppEnv;
if (originalAllowTopUp === undefined) delete process.env.ALLOW_PLACEHOLDER_TOPUP;
else process.env.ALLOW_PLACEHOLDER_TOPUP = originalAllowTopUp;

const limitedRequest = new Request("https://unit.test", { headers: { "x-forwarded-for": `192.0.2.${Date.now() % 200}` } });
assert.equal(rateLimit.checkRateLimit(limitedRequest, { key: "unit", limit: 1, windowMs: 60_000 }).ok, true, "first request should pass rate limit");
const secondLimit = rateLimit.checkRateLimit(limitedRequest, { key: "unit", limit: 1, windowMs: 60_000 });
assert.equal(secondLimit.ok, false, "second request should fail rate limit");
assert.equal(secondLimit.retryAfterSeconds > 0, true, "rate limit response should include retry seconds");

console.log("Unit check passed.");
