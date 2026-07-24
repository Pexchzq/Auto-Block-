// Split a cookies file into N group files for distributed runs (วิธี A).
// Usage: node split-accounts.mjs cookies.txt 3
// -> writes cookies-1.txt, cookies-2.txt, cookies-3.txt (round-robin, balanced)
// Does NOT print cookie contents.
import fs from "node:fs";

const src = process.argv[2] || "cookies.txt";
const groups = Math.max(2, parseInt(process.argv[3] || "3", 10));

if (!fs.existsSync(src)) {
  console.error(`Missing input: ${src}`);
  process.exit(1);
}

const lines = fs.readFileSync(src, "utf8").split(/\r?\n/);
const cookies = lines.filter((l) => l.includes("_|WARNING"));
if (cookies.length === 0) {
  console.error("No cookie lines found (need _|WARNING).");
  process.exit(1);
}

// Round-robin keeps groups balanced even if the total isn't divisible.
const buckets = Array.from({ length: groups }, () => []);
cookies.forEach((line, i) => buckets[i % groups].push(line));

const base = src.replace(/\.txt$/i, "");
buckets.forEach((bucket, i) => {
  const out = `${base}-${i + 1}.txt`;
  fs.writeFileSync(out, `# group ${i + 1}/${groups} (${bucket.length} accounts)\n${bucket.join("\n")}\n`);
  console.log(`${out}: ${bucket.length} accounts`);
});

console.log(`\nDone. ${cookies.length} accounts -> ${groups} groups.`);
console.log(`Copy each cookies-N.txt to its own machine and run:`);
console.log(`  node block-mesh.js apply --cookies cookies-N.txt --mode balanced --allow-unverified-blocklist --skip-block-list-check`);
