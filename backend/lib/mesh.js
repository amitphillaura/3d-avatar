import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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

// Same resolution as processor.js: prefer the venv interpreter when present.
// On WSL2/Linux/macOS this is the POSIX layout used across the backend.
const PYTHON_BIN = existsSync(join(BACKEND_DIR, ".venv/bin/python3"))
  ? join(BACKEND_DIR, ".venv/bin/python3")
  : "python3";

export const MESH_ENGINES = ["triposr", "sf3d", "hunyuan3d"];
export const DEFAULT_ENGINE = "triposr"; // switch to hunyuan3d once installed
export const INSTALLED_ENGINES = ["triposr"]; // engines actually wired up in Phase 1

const IMAGE_EXT = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp"
};

export function newMeshJobId() {
  return randomUUID();
}

export function isSupportedImage(mimetype) {
  return Object.prototype.hasOwnProperty.call(IMAGE_EXT, mimetype || "");
}

export function imageExtFor(mimetype, filename) {
  return IMAGE_EXT[mimetype] || extname(filename || "").toLowerCase() || ".png";
}

export function saveUploadedImage(buffer, jobId, mimetype, filename) {
  ensureMeshJobDir(jobId);
  const ext = imageExtFor(mimetype, filename);
  const target = meshSourcePath(jobId, ext);
  writeFileSync(target, buffer);
  return target;
}

export function deleteMeshAssets(jobId) {
  const dir = meshJobDir(jobId);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

/** Mirror recoverStaleProcessing: any job left mid-flight on restart fails. */
export function recoverStaleMeshJobs(db) {
  const stuck = db.prepare("SELECT id FROM mesh_jobs WHERE status = 'running'").all();
  if (!stuck.length) return;
  db.prepare(`
    UPDATE mesh_jobs
    SET status = 'failed',
        error = 'Interrupted (server restart)',
        updated_at = datetime('now')
    WHERE status = 'running'
  `).run();
  console.log(`Recovered ${stuck.length} mesh job(s) stuck in running`);
}

/** Spawn generate_mesh.py and resolve its final JSON status line. */
function runMeshWorker({ imagePath, outputPath, engine, removeBg, texture }, onProgress) {
  return new Promise((resolvePromise, reject) => {
    const args = [
      GENERATE_SCRIPT,
      "--image", imagePath,
      "--output", outputPath,
      "--engine", engine
    ];
    if (removeBg) args.push("--remove-bg");
    if (texture) args.push("--texture");

    const child = spawn(PYTHON_BIN, args, {
      cwd: PROJECT_ROOT,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdoutBuf = "";
    let stderr = "";
    let metaLine = "{}";

    child.stdout.on("data", (chunk) => {
      stdoutBuf += chunk.toString();
      const lines = stdoutBuf.split("\n");
      stdoutBuf = lines.pop(); // keep incomplete line
      for (const line of lines) {
        if (line.startsWith("PROGRESS:")) {
          const pct = parseInt(line.slice(9), 10);
          if (!Number.isNaN(pct) && onProgress) onProgress(pct);
        } else if (line.trim()) {
          metaLine = line;
        }
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      reject(new Error(`Failed to start mesh worker (${PYTHON_BIN}): ${error.message}`));
    });
    child.on("close", (code) => {
      if (stdoutBuf.trim()) {
        if (stdoutBuf.startsWith("PROGRESS:")) {
          const pct = parseInt(stdoutBuf.slice(9), 10);
          if (!Number.isNaN(pct) && onProgress) onProgress(pct);
        } else {
          metaLine = stdoutBuf;
        }
      }
      if (code !== 0) {
        reject(new Error(stderr.trim() || metaLine || `Mesh worker exited with code ${code}`));
        return;
      }
      try {
        resolvePromise(JSON.parse(metaLine));
      } catch {
        resolvePromise({});
      }
    });
  });
}

/**
 * Run a queued mesh job to completion. Walks status queued -> running -> ready,
 * or -> failed with the error recorded. Mirrors processVideoJob.
 */
export async function processMeshJob({ db, jobId }) {
  const job = db.prepare("SELECT * FROM mesh_jobs WHERE id = ?").get(jobId);
  if (!job) throw new Error(`Mesh job not found: ${jobId}`);

  const params = safeParse(job.params_json) || {};
  const outputPath = meshResultPath(jobId);
  ensureMeshJobDir(jobId);

  db.prepare(`
    UPDATE mesh_jobs SET status = 'running', error = NULL, updated_at = datetime('now')
    WHERE id = ?
  `).run(jobId);

  try {
    const meta = await runMeshWorker({
      imagePath: job.source_path,
      outputPath,
      engine: job.engine,
      removeBg: Boolean(params.remove_bg),
      texture: params.texture !== false // default on: a flat-gray mesh is useless
    });

    if (!existsSync(outputPath)) {
      throw new Error("Worker finished but no result.glb was produced");
    }

    db.prepare(`
      UPDATE mesh_jobs
      SET status = 'ready',
          result_path = ?,
          error = NULL,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(outputPath, jobId);

    return { jobId, meta };
  } catch (error) {
    db.prepare(`
      UPDATE mesh_jobs SET status = 'failed', error = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(error.message, jobId);
    throw error;
  }
}

function safeParse(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
