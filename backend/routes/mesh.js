import { createReadStream, existsSync } from "node:fs";
import { exec } from "node:child_process";
import { getDb } from "../db/index.js";
import { meshResultPath } from "../lib/paths.js";
import {
  DEFAULT_ENGINE,
  INSTALLED_ENGINES,
  MESH_ENGINES,
  deleteMeshAssets,
  imageExtFor,
  isSupportedImage,
  newMeshJobId,
  processMeshJob,
  saveUploadedImage
} from "../lib/mesh.js";

// Lower than the global 512 MB body limit — images don't need more.
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

// Track in-flight jobs to guard against double-processing (mirror routes/index.js).
const running = new Set();

function parseBool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return value === true || value === "true" || value === "1" || value === "on";
}

function detectGpu() {
  // Best-effort GPU name for /health. Short timeout; null if unavailable.
  return new Promise((resolvePromise) => {
    exec("nvidia-smi --query-gpu=name,memory.total --format=csv,noheader", { timeout: 4000 }, (err, stdout) => {
      if (err || !stdout?.trim()) {
        resolvePromise(null);
        return;
      }
      resolvePromise(stdout.trim().split("\n")[0].trim());
    });
  });
}

function serializeJob(row) {
  if (!row) return null;
  const { params_json, ...rest } = row;
  let params = null;
  try {
    params = params_json ? JSON.parse(params_json) : null;
  } catch {
    params = null;
  }
  return { ...rest, params };
}

export function registerMeshRoutes(app) {
  app.get("/api/mesh/health", async () => {
    const gpu = await detectGpu();
    return {
      ok: true,
      service: "mesh-api",
      gpu,
      engines: INSTALLED_ENGINES,
      default_engine: DEFAULT_ENGINE
    };
  });

  app.post("/api/mesh/jobs", async (request, reply) => {
    const file = await request.file({ limits: { fileSize: MAX_IMAGE_BYTES } });
    if (!file) return reply.code(400).send({ error: "Missing image file" });

    if (!isSupportedImage(file.mimetype)) {
      return reply.code(415).send({
        error: `Unsupported image type '${file.mimetype}'. Use PNG, JPEG, or WebP.`
      });
    }

    let buffer;
    try {
      buffer = await file.toBuffer();
    } catch {
      return reply.code(413).send({ error: "Image exceeds 25 MB limit" });
    }
    if (file.file?.truncated) {
      return reply.code(413).send({ error: "Image exceeds 25 MB limit" });
    }

    const fields = file.fields || {};
    const engine = fields.engine?.value || DEFAULT_ENGINE;
    if (!MESH_ENGINES.includes(engine)) {
      return reply.code(400).send({ error: `Unknown engine '${engine}'` });
    }
    if (!INSTALLED_ENGINES.includes(engine)) {
      return reply.code(409).send({
        error: `Engine '${engine}' is not installed yet. Installed: ${INSTALLED_ENGINES.join(", ")}`
      });
    }

    const params = {
      remove_bg: parseBool(fields.remove_bg?.value, true),
      texture: parseBool(fields.texture?.value, true)
    };

    const jobId = newMeshJobId();
    const sourcePath = saveUploadedImage(buffer, jobId, file.mimetype, file.filename);

    const db = getDb();
    db.prepare(`
      INSERT INTO mesh_jobs (id, status, stage, engine, source_path, params_json)
      VALUES (?, 'queued', 'mesh', ?, ?, ?)
    `).run(jobId, engine, sourcePath, JSON.stringify(params));

    // Kick off processing asynchronously (submit -> poll -> download).
    running.add(jobId);
    processMeshJob({ db, jobId })
      .catch((error) => console.error(`Mesh job failed for ${jobId}:`, error.message))
      .finally(() => running.delete(jobId));

    return reply.code(201).send({ job_id: jobId, status: "queued", engine });
  });

  app.get("/api/mesh/jobs", async () => {
    const db = getDb();
    const rows = db.prepare("SELECT * FROM mesh_jobs ORDER BY created_at DESC").all();
    return { jobs: rows.map(serializeJob) };
  });

  app.get("/api/mesh/jobs/:id", async (request, reply) => {
    const db = getDb();
    const job = db.prepare("SELECT * FROM mesh_jobs WHERE id = ?").get(request.params.id);
    if (!job) return reply.code(404).send({ error: "Job not found" });
    return { job: serializeJob(job) };
  });

  app.get("/api/mesh/jobs/:id/result", async (request, reply) => {
    const db = getDb();
    const job = db.prepare("SELECT * FROM mesh_jobs WHERE id = ?").get(request.params.id);
    if (!job) return reply.code(404).send({ error: "Job not found" });
    if (job.status !== "ready") {
      return reply.code(409).send({ error: `Job not ready (status: ${job.status})` });
    }
    const path = meshResultPath(job.id);
    if (!existsSync(path)) return reply.code(404).send({ error: "Result file missing" });
    reply.header("Content-Type", "model/gltf-binary");
    reply.header("Content-Disposition", `inline; filename="${job.id}.glb"`);
    return reply.send(createReadStream(path));
  });

  app.delete("/api/mesh/jobs/:id", async (request, reply) => {
    const db = getDb();
    const job = db.prepare("SELECT id FROM mesh_jobs WHERE id = ?").get(request.params.id);
    if (!job) return reply.code(404).send({ error: "Job not found" });
    if (running.has(job.id)) return reply.code(409).send({ error: "Job is processing" });
    db.prepare("DELETE FROM mesh_jobs WHERE id = ?").run(job.id);
    deleteMeshAssets(job.id);
    return reply.code(204).send();
  });

  // --- Phase 2 (mesh -> VRM): contract reserved, not implemented yet. --------
  app.post("/api/mesh/jobs/:id/rig", async (_request, reply) =>
    reply.code(501).send({ error: "Phase 2 (rig -> VRM) not implemented yet" })
  );
  app.get("/api/mesh/jobs/:id/vrm", async (_request, reply) =>
    reply.code(501).send({ error: "Phase 2 (rig -> VRM) not implemented yet" })
  );
}
