import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 5199;
const child = spawn(process.execPath, ["backend/server.js"], {
  cwd: root,
  env: { ...process.env, MOTION_API_PORT: String(PORT) },
  stdio: ["ignore", "pipe", "pipe"]
});

let stderr = "";
child.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});

try {
  await sleep(2500);
  const response = await fetch(`http://127.0.0.1:${PORT}/api/health`);
  if (!response.ok) {
    throw new Error(`Health check failed (${response.status})`);
  }
  const body = await response.json();
  if (!body?.ok) {
    throw new Error("Health body missing ok:true");
  }
  console.log("Motion API smoke OK");
} catch (error) {
  console.error(stderr.trim() || error.message);
  process.exitCode = 1;
} finally {
  child.kill("SIGTERM");
}
