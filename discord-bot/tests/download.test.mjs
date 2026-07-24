import test from "node:test";
import assert from "node:assert/strict";
import { downloadAccountText, isAllowedAccountFileUrl } from "../src/download.mjs";
import { sanitizeError } from "../src/sanitize.mjs";

test("Discord CDN attachment URLs are accepted", () => {
  assert.equal(
    isAllowedAccountFileUrl("https://cdn.discordapp.com/attachments/1/2/cookies.txt?ex=abc"),
    true,
  );
  assert.equal(
    isAllowedAccountFileUrl("https://media.discordapp.net/attachments/1/2/cookies.txt"),
    true,
  );
});

test("other URL targets are rejected", () => {
  assert.equal(isAllowedAccountFileUrl("http://cdn.discordapp.com/attachments/1/2/a.txt"), false);
  assert.equal(isAllowedAccountFileUrl("https://example.com/attachments/1/2/a.txt"), false);
  assert.equal(isAllowedAccountFileUrl("https://cdn.discordapp.com/not-attachments/a.txt"), false);
  assert.equal(isAllowedAccountFileUrl("https://cdn.discordapp.com/attachments/1/2/a.exe"), false);
});

test("engine sanitizer is reused", () => {
  assert.equal(sanitizeError("bad _|WARNING:secret"), "bad [REDACTED_COOKIE]");
  assert.equal(
    sanitizeError("x-csrf-token=abc123"),
    "x-csrf-token=[REDACTED_TOKEN]",
  );
});

test("download rejects redirects without following them", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response(null, {
    status: 302,
    headers: { location: "https://example.com/file.txt" },
  });

  await assert.rejects(
    downloadAccountText("https://cdn.discordapp.com/attachments/1/2/cookies.txt"),
    /redirect/,
  );
});

test("download enforces the byte limit", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  const oversized = "x".repeat(2_048);
  globalThis.fetch = async () => new Response(oversized, {
    status: 200,
    headers: { "content-length": String(oversized.length) },
  });

  await assert.rejects(
    downloadAccountText("https://cdn.discordapp.com/attachments/1/2/cookies.txt", { maxBytes: 1_024 }),
    /ขนาดเกิน/,
  );
});
