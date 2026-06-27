import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream, existsSync, rmSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "../db/index.js";
import {
  ensureMeshJobDir,
  meshJobDir,
  meshResultPath,
  meshSourcePath,
  PROJECT_ROOT
} from "./paths.js";

const WORKER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../worker");
const BACKEND_DIR = resolve(WORKER_DIR, "..");
const GENERATE_SCRIPT = join(WORKER_DIR, "generate_mesh.py");

const PYTHON_BIN = existsSync(join(BACKEND_DIR, ".venv/bin/python3"))
  ? join(BACKEND_DIR, ".venv/bin/python3")
  : "python3";

export const MESH_ENGINES = ["triposr", "sf3d", "hunyuan3d"];
export const DEFAULT_ENGINE = "triposr";
export const INSTALLED_ENGINES = ["triposr"];
const DEFAULT_DURATION_MS = 55000; // ETA fallback before any job has completed

const IMAGE_EXT = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp" };

// --- one-time column migration for pre-existing DBs (mirror ensureProgressColumn)
let migrated = false;
export function ensureMeshColumns(db) {
  if (migrated) return;
  const cols = new Set(db.prepare("PRAGMA table_info(mesh_jobs)").all().map((c) => c.name));
  const add = (name, decl) => {
    if (!cols.has(name)) db.prepare(`ALTER TABLE mesh_jobs ADD COLUMN ${name} ${decl}`).run();
  };
  add("error_code", "TEXT");
  add("error_stage", "TEXT");
  add("params_applied_json", "TEXT");
  add("result_json", "TEXT");
  add("sha256", "TEXT");
  add("progress", "INTEGER NOT NULL DEFAULT 0");
  add("started_at", "TEXT");
  add("finished_at", "TEXT");
  add("duration_ms", "INTEGER");
  add("queue_wait_ms", "INTEGER");
  db.prepare("CREATE INDEX IF NOT EXISTS idx_mesh_jobs_sha ON mesh_jobs(sha256)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_mesh_jobs_status ON mesh_jobs(status)").run();
  migrated = true;
}

export function sha256File(path) {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (c) => hash.update(c))
      .on("error", reject)
      .on("end", () => resolvePromise(hash.digest("hex")));
  });
}

/** Dedup key: image bytes + the params that change the output. */
export function computeJobSha(buffer, engine, params) {
  const h = createHash("sha256");
  h.update(buffer);
  h.update(`|${engine}|rb:${params.remove_bg ? 1 : 0}|tx:${params.texture ? 1 : 0}|nm:${params.normalize === false ? 0 : 1}`);
  return h.digest("hex");
}

export function newMeshJobId() {
  return randomUUID();
}
export function isSupportedImage(m) {
  return Object.prototype.hasOwnProperty.call(IMAGE_EXT, m || "");
}
export function imageExtFor(m, filename) {
  return IMAGE_EXT[m] || extname(filename || "").toLowerCase() || ".png";
}
export function saveUploadedImage(buffer, jobId, mimetype, filename) {
  ensureMeshJobDir(jobId);
  const target = meshSourcePath(jobId, imageExtFor(mimetype, filename));
  writeFileSync(target, buffer);
  return target;
}
export function deleteMeshAssets(jobId) {
  const dir = meshJobDir(jobId);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

// --------------------------------------------------------------------------- //
// Single-GPU job queue (jobs serialize; one worker at a time).
// --------------------------------------------------------------------------- //
const queue = [];
let activeJobId = null;

export function enqueueMeshJob(jobId) {
  queue.push(jobId);
  pump();
}

export function getQueueState() {
  return { busy: Boolean(activeJobId), active_job: activeJobId, queue_depth: queue.length };
}

/** ETA helper: jobs ahead of `jobId` (counts the in-flight one). */
export function jobsAhead(jobId) {
  const idx = queue.indexOf(jobId);
  if (idx < 0) return 0;
  return idx + (activeJobId ? 1 : 0);
}

export function avgDurationMs(db) {
  const row = db
    .prepare("SELECT AVG(duration_ms) AS a FROM mesh_jobs WHERE status='ready' AND duration_ms > 0")
    .get();
  return Math.round(row?.a || DEFAULT_DURATION_MS);
}

async function pump() {
  if (activeJobId) return;
  const jobId = queue.shift();
  if (!jobId) return;
  activeJobId = jobId;
  try {
    await processMeshJob(jobId);
  } catch (err) {
    console.error(`Mesh job ${jobId} failed:`, err.message);
  } finally {
    activeJobId = null;
    pump();
  }
}

/** On restart: drop the in-memory queue and fail anything left running. */
export function recoverStaleMeshJobs(db) {
  ensureMeshColumns(db);
  queue.length = 0;
  activeJobId = null;
  const stuck = db.prepare("SELECT id FROM mesh_jobs WHERE status='running'").all();
  if (!stuck.length) return;
  db.prepare(`
    UPDATE mesh_jobs
    SET status='failed', error='Interrupted (server restart)',
        error_code='interrupted', error_stage='runtime',
        finished_at=datetime('now'), updated_at=datetime('now')
    WHERE status='running'
  `).run();
  console.log(`Recovered ${stuck.length} mesh job(s) stuck in running`);
}

function utcMs(sqliteTime) {
  if (!sqliteTime) return Date.now();
  const ms = Date.parse(`${sqliteTime.replace(" ", "T")}Z`);
  return Number.isNaN(ms) ? Date.now() : ms;
}

function runMeshWorker({ imagePath, outputPath, engine, removeBg, texture, normalize }, onProgress) {
  return new Promise((resolvePromise, reject) => {
    const args = [GENERATE_SCRIPT, "--image", imagePath, "--output", outputPath, "--engine", engine];
    if (removeBg) args.push("--remove-bg");
    if (texture) args.push("--texture");
    if (normalize === false) args.push("--no-normalize");

    const child = spawn(PYTHON_BIN, args, { cwd: PROJECT_ROOT, stdio: ["ignore", "pipe", "pipe"] });
    let stdoutBuf = "";
    let stderr = "";
    let metaLine = "{}";

    const handleLine = (line) => {
      if (line.startsWith("PROGRESS:")) {
        const pct = parseInt(line.slice(9), 10);
        if (!Number.isNaN(pct) && onProgress) onProgress(pct);
      } else if (line.trim()) {
        metaLine = line;
      }
    };

    child.stdout.on("data", (chunk) => {
      stdoutBuf += chunk.toString();
      const lines = stdoutBuf.split("\n");
      stdoutBuf = lines.pop();
      for (const line of lines) handleLine(line);
    });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (e) => {
      const err = new Error(`Failed to start mesh worker (${PYTHON_BIN}): ${e.message}`);
      err.code = "worker_spawn_failed";
      err.stage = "spawn";
      reject(err);
    });
    child.on("close", (code) => {
      if (stdoutBuf.trim()) handleLine(stdoutBuf);
      let meta = {};
      try { meta = JSON.parse(metaLine); } catch { /* leave {} */ }
      if (code !== 0) {
        const s = meta?.error || {};
        const err = new Error(s.message || stderr.trim() || `Mesh worker exited ${code}`);
        err.code = s.code || "worker_failed";
        err.stage = s.stage || "runtime";
        reject(err);
        return;
      }
      resolvePromise(meta);
    });
  });
}

export async function processMeshJob(jobId) {
  const db = getDb();
  ensureMeshColumns(db);
  const job = db.prepare("SELECT * FROM mesh_jobs WHERE id = ?").get(jobId);
  if (!job) throw new Error(`Mesh job not found: ${jobId}`);

  const params = safeParse(job.params_json) || {};
  const outputPath = meshResultPath(jobId);
  ensureMeshJobDir(jobId);

  const t0 = Date.now();
  const queueWaitMs = Math.max(0, t0 - utcMs(job.created_at));
  db.prepare(`
    UPDATE mesh_jobs
    SET status='running', progress=0, started_at=datetime('now'), queue_wait_ms=?,
        error=NULL, error_code=NULL, error_stage=NULL, updated_at=datetime('now')
    WHERE id=?
  `).run(queueWaitMs, jobId);

  let lastPct = 0;
  try {
    const meta = await runMeshWorker(
      {
        imagePath: job.source_path,
        outputPath,
        engine: job.engine,
        removeBg: Boolean(params.remove_bg),
        texture: params.texture !== false,
        normalize: params.normalize !== false
      },
      (pct) => {
        if (pct !== lastPct) {
          lastPct = pct;
          db.prepare("UPDATE mesh_jobs SET progress=?, updated_at=datetime('now') WHERE id=?").run(pct, jobId);
        }
      }
    );

    if (!existsSync(outputPath)) {
      const e = new Error("Worker finished but no result.glb was produced");
      e.code = "no_output";
      e.stage = "export";
      throw e;
    }

    const sha = await sha256File(outputPath);
    const result = {
      ...(meta.result || {}),
      sha256: sha,
      device: meta.device,
      seconds: meta.seconds,
      artifacts: meta.artifacts || {}
    };
    const durationMs = Date.now() - t0;

    db.prepare(`
      UPDATE mesh_jobs
      SET status='ready', progress=100, result_path=?, result_json=?, params_applied_json=?,
          finished_at=datetime('now'), duration_ms=?, error=NULL, updated_at=datetime('now')
      WHERE id=?
    `).run(outputPath, JSON.stringify(result), JSON.stringify(meta.params_applied || {}), durationMs, jobId);

    return { jobId, meta };
  } catch (error) {
    const durationMs = Date.now() - t0;
    db.prepare(`
      UPDATE mesh_jobs
      SET status='failed', error=?, error_code=?, error_stage=?,
          finished_at=datetime('now'), duration_ms=?, updated_at=datetime('now')
      WHERE id=?
    `).run(error.message, error.code || "worker_failed", error.stage || "runtime", durationMs, jobId);
    throw error;
  }
}

function safeParse(value) {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}
