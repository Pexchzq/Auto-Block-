import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(__dirname, "..");
const rootDir = path.resolve(webDir, "..");
const workerDir = path.join(rootDir, "worker");
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

function run(label, command, args, cwd) {
  console.log(`\n== ${label} ==`);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      shell: process.platform === "win32",
    });

    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} failed with exit code ${code}`));
    });
  });
}

try {
  await run("web unit check", npmCmd, ["run", "unit:check"], webDir);
  await run("supabase schema check", npmCmd, ["run", "schema:check"], webDir);
  await run("web lint", npmCmd, ["run", "lint"], webDir);
  await run("web build", npmCmd, ["run", "build"], webDir);
  await run("worker syntax check", npmCmd, ["run", "check"], workerDir);
  await run("worker self-test", npmCmd, ["run", "self-test"], workerDir);
  console.log("\nPredeploy check passed.");
} catch (error) {
  console.error(`\nPredeploy check failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
