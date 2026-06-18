import assert from "node:assert/strict";

const accounts = await import("../src/lib/accounts.ts");
const payment = await import("../src/lib/payment-mode.ts");
const pricing = await import("../src/lib/pricing.ts");
const rateLimit = await import("../src/lib/rate-limit.ts");
const sanitizer = await import("../src/lib/report-sanitizer.ts");

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
assert.equal(colonPassword.ok, false, "passwords containing ':' are intentionally unsupported");

assert.equal(pricing.getDirectedPairs(10), 90, "10 accounts should produce 90 directed pairs");
assert.equal(pricing.getDirectedPairs(80), 6320, "80 accounts should produce 6320 directed pairs");
assert.equal(pricing.getDirectedPairs(220), 48180, "220 accounts should produce 48180 directed pairs");
assert.equal(pricing.getDirectedPairs(500), 249500, "500 accounts should produce 249500 directed pairs");
assert.equal(pricing.createQuote(500).pricingTier, "volume", "500 account quote should use volume pricing");
assert.equal(pricing.roundBaht(1.005), 1, "roundBaht should preserve existing Math.round behavior");

assert.equal(pricing.isValidTrueMoneyVoucherUrl("https://gift.truemoney.com/campaign/?v=abc"), true, "valid TrueMoney voucher URL should pass format check");
assert.equal(pricing.isValidTrueMoneyVoucherUrl("https://example.com/campaign/?v=abc"), false, "non-TrueMoney URL should fail format check");

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
