// Human-readable label per account-level failure reason. Keys match
// classifyAuthFailure()/parseCookiesFile() statuses in block-mesh.js.
const UNUSABLE_REASON_LABELS = {
  moderated: "ติดล็อกโมเดอเรชัน (ต้องยืนยันอายุ/ใบหน้าในแอป Roblox เอง)",
  banned: "บัญชีถูกแบน",
  invalid_cookie: "คุกกี้หมดอายุหรือใช้ไม่ได้",
  challenge_captcha: "ติดแคปช่า",
  challenge_2fa: "ติดการยืนยันสองขั้นตอน",
  challenge_verification: "ต้องยืนยันตัวตนเพิ่มเติม",
  rate_limited: "โดน rate limit ตอนตรวจสอบบัญชี",
  server_error: "เซิร์ฟเวอร์ Roblox ผิดพลาดชั่วคราว",
  invalid_format: "รูปแบบบรรทัดผิด",
  auth_failed: "ล็อกอินไม่ผ่าน",
  exception: "เชื่อมต่อผิดพลาดชั่วคราว",
};

export function unusableReasonLabel(status) {
  return UNUSABLE_REASON_LABELS[status] || status || "ไม่ทราบสาเหตุ";
}

// Pull the per-account pass/fail breakdown out of the CLI's full report
// instead of forwarding the whole (large, mostly-noise) JSON to the user.
export function summarizeUnusableAccounts(report) {
  const accounts = Array.isArray(report?.accounts) ? report.accounts : [];
  const unusable = accounts.filter((account) => account && account.valid === false);
  const breakdown = new Map();
  for (const account of unusable) {
    const key = account.status || "unknown";
    breakdown.set(key, (breakdown.get(key) || 0) + 1);
  }
  return { unusable, breakdown };
}

export function unusableBreakdownField(breakdown) {
  if (!breakdown || breakdown.size === 0) return null;
  const value = [...breakdown.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([status, total]) => `• **${unusableReasonLabel(status)}**: ${total} ไอดี`)
    .join("\n");
  return { name: "🔴 สาเหตุที่ใช้ไม่ได้", value };
}

export function unusableAccountsFileText(unusable) {
  const lines = (unusable || []).map((account) => {
    const reason = unusableReasonLabel(account.status);
    return `${account.alias} (บรรทัด ${account.lineNo}): ${reason}`;
  });
  return lines.length ? `${lines.join("\n")}\n` : "";
}
