export function countAccountLines(accountText: string): number {
  return accountText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .length;
}

export function resolveAccountCount(input: { accountCount?: number; accountText?: string }): number {
  const textCount = countAccountLines(String(input.accountText || ""));
  if (textCount > 0) return textCount;
  return Math.floor(Number(input.accountCount || 0));
}

export type AccountInputValidation = {
  ok: boolean;
  count: number;
  invalidLines: number[];
  error?: string;
};

export function validateAccountInput(accountText: string, options: { required?: boolean; maxAccounts?: number } = {}): AccountInputValidation {
  const maxAccounts = options.maxAccounts ?? 5000;
  const lines = accountText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  if (options.required && lines.length === 0) {
    return { ok: false, count: 0, invalidLines: [], error: "Account input is required" };
  }

  if (lines.length > maxAccounts) {
    return { ok: false, count: lines.length, invalidLines: [], error: `Account input exceeds ${maxAccounts} accounts` };
  }

  const invalidLines: number[] = [];
  lines.forEach((line, index) => {
    // Anchor on the Roblox cookie marker so the parser accepts the cookie no
    // matter how many colon-separated fields precede it (username:password:cookie,
    // username:cookie, or a raw cookie). The password field is optional and is
    // never used for authentication.
    const warnIndex = line.indexOf("_|WARNING");
    const cookie = warnIndex >= 0 ? line.slice(warnIndex).trim() : "";
    if (warnIndex < 0 || !cookie.startsWith("_|WARNING")) {
      invalidLines.push(index + 1);
    }
  });

  if (invalidLines.length > 0) {
    const preview = invalidLines.slice(0, 8).join(", ");
    return {
      ok: false,
      count: lines.length,
      invalidLines,
      error: `Invalid account format on line(s): ${preview}${invalidLines.length > 8 ? ", ..." : ""}`,
    };
  }

  return { ok: true, count: lines.length, invalidLines: [] };
}
