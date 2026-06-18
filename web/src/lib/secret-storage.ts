import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const PREFIX = "enc:v1:";

function encryptionKey(): Buffer | null {
  const raw = process.env.JOB_INPUT_ENCRYPTION_KEY;
  if (!raw) return null;
  return createHash("sha256").update(raw).digest();
}

export function isEncryptedSecret(value: string): boolean {
  return value.startsWith(PREFIX);
}

export function encryptSecret(value: string): string {
  const key = encryptionKey();
  if (!key || !value) return value;

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${Buffer.concat([iv, tag, ciphertext]).toString("base64")}`;
}

export function decryptSecret(value: string): string {
  const key = encryptionKey();
  if (!value || !isEncryptedSecret(value)) return value;
  if (!key) throw new Error("JOB_INPUT_ENCRYPTION_KEY is required to decrypt stored job input");

  const payload = Buffer.from(value.slice(PREFIX.length), "base64");
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(12, 28);
  const ciphertext = payload.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
