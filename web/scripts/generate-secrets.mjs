import { randomBytes } from "node:crypto";

function secret(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

const workerToken = secret(32);
const jobInputKey = secret(32);
const webhookSecret = secret(32);

console.log("Generated BlockMesh production secrets\n");
console.log("Set these in Vercel web env:");
console.log(`WORKER_API_TOKEN=${workerToken}`);
console.log(`JOB_INPUT_ENCRYPTION_KEY=${jobInputKey}`);
console.log(`TRUEMONEY_WEBHOOK_SECRET=${webhookSecret}`);
console.log("");
console.log("Set this in worker/.env:");
console.log(`WORKER_API_TOKEN=${workerToken}`);
console.log("");
console.log("Keep these values private. Do not commit them.");
