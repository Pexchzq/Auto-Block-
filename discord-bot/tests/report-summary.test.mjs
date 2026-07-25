import test from "node:test";
import assert from "node:assert/strict";
import {
  summarizeUnusableAccounts,
  unusableAccountsFileText,
  unusableBreakdownField,
  unusableReasonLabel,
} from "../src/report-summary.mjs";

const sampleReport = {
  accounts: [
    { alias: "miars858", lineNo: 1, valid: true, status: "ok" },
    { alias: "sidie037", lineNo: 4, valid: false, status: "moderated", error: "User is moderated" },
    { alias: "writz391", lineNo: 6, valid: false, status: "moderated", error: "User is moderated" },
    { alias: "deadcookie1", lineNo: 9, valid: false, status: "invalid_cookie", error: "status_401" },
  ],
};

test("summarizeUnusableAccounts only counts invalid accounts, grouped by status", () => {
  const { unusable, breakdown } = summarizeUnusableAccounts(sampleReport);
  assert.equal(unusable.length, 3, "3 of 4 accounts are invalid");
  assert.equal(breakdown.get("moderated"), 2);
  assert.equal(breakdown.get("invalid_cookie"), 1);
});

test("summarizeUnusableAccounts handles a missing/empty report gracefully", () => {
  assert.deepEqual(summarizeUnusableAccounts(null), { unusable: [], breakdown: new Map() });
  assert.deepEqual(summarizeUnusableAccounts({}), { unusable: [], breakdown: new Map() });
});

test("unusableBreakdownField renders a sorted, human-readable field or null", () => {
  const { breakdown } = summarizeUnusableAccounts(sampleReport);
  const field = unusableBreakdownField(breakdown);
  assert.equal(field.name, "🔴 สาเหตุที่ใช้ไม่ได้");
  assert.match(field.value, /ติดล็อกโมเดอเรชัน.*2 ไอดี/s, "translated label with count, not the raw status key");
  assert.match(field.value, /ติดล็อกโมเดอเรชัน[\s\S]*คุกกี้หมดอายุ/, "sorted by count descending (2 before 1)");
  assert.equal(unusableBreakdownField(new Map()), null, "no breakdown when everything is valid");
});

test("unusableAccountsFileText lists alias + line + reason, empty string when none", () => {
  const { unusable } = summarizeUnusableAccounts(sampleReport);
  const text = unusableAccountsFileText(unusable);
  assert.match(text, /sidie037 \(บรรทัด 4\):/);
  assert.match(text, /writz391 \(บรรทัด 6\):/);
  assert.equal(unusableAccountsFileText([]), "");
});

test("unusableReasonLabel falls back to the raw status for unknown reasons", () => {
  assert.equal(unusableReasonLabel("moderated"), "ติดล็อกโมเดอเรชัน (ต้องยืนยันอายุ/ใบหน้าในแอป Roblox เอง)");
  assert.equal(unusableReasonLabel("some_future_status"), "some_future_status");
  assert.equal(unusableReasonLabel(undefined), "ไม่ทราบสาเหตุ");
});
