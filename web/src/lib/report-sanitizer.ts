const SECRET_KEY_PATTERN = /(cookie|password|token|csrf|authorization|account_text|accountText|secret)/i;

export function sanitizeReportValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[Max depth]";
  if (Array.isArray(value)) return value.slice(0, 500).map((item) => sanitizeReportValue(item, depth + 1));
  if (!value || typeof value !== "object") return value;

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    output[key] = SECRET_KEY_PATTERN.test(key) ? "[REDACTED]" : sanitizeReportValue(entry, depth + 1);
  }
  return output;
}
