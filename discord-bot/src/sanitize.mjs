import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const engine = require(path.resolve(__dirname, "..", "..", "block-mesh.js"));

export function sanitizeError(value) {
  return engine.sanitizeError(String(value || "Unknown error"));
}

export function safeError(error) {
  return sanitizeError(error instanceof Error ? error.message : String(error || "Unknown error"));
}
