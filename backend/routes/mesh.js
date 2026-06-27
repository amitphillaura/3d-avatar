import { createReadStream, existsSync, statSync } from "node:fs";
import { exec } from "node:child_process";
import { getDb } from "../db/index.js";
import { meshResultPath, meshThumbnailPath, meshInputCutoutPath } from "../lib/paths.js";
import {
  DEFAULT_ENGINE,
  INSTALLED_ENGINES,
  MESH_ENGINES,
  avgDurationMs,
  computeJobSha,
  deleteMeshAssets,
  enqueueMeshJob,
  ensureMeshColumns,
  getQueueState,
  jobsAhead,
  newMeshJobId,
  saveUploadedImage,
  isSupportedImage
} from "../lib/mesh.js";

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

function parseBool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return value === true || value === "true" || value === "1" || value === "on";
}

function detectGpu() {
  return new Promise((resolvePromise) => {
    exec("nvidia-smi --query-gpu=name,memory.total,memory.used --format=csv,noheader", { timeout: 4000 }, (err, stdout) => {
      resolvePromise(err || !stdout?.trim() ? null : stdout.trim().split("\n")[0].trim());
    });
  });
}

function safeParse(v) {
  if (!v) return null;
  try { return JSON.parse(v); } catch { return null; }
}

/** Client-facing job shape: URLs not filesystem paths, with metadata + timing. */
function serializeJob(row, db) {
  if (!row) return null;
  const base = `/api/mesh/jobs/${row.id}`;
  const result = safeParse(row.result_json);
  const out = {
    id: row.id,
    status: row.status,
    stage: row.stage,
    engine: row.engine,
    progress: row.progress ?? 0,
    params_requested: safeParse(row.params_json),
    params_applied: safeParse(row.params_applied_json),
    result: row.status === "ready" ? result : null,
    timing: {
      created_at: row.created_at,
      started_at: row.started_at || null,
      finished_at: row.finished_at || null,
      duration_ms: row.duration_ms ?? null,
      queue_wait_ms: row.queue_wait_ms ?? null
    },
    error: row.status === "failed"
      ? { code: row.error_code || "worker_failed", message: row.error || "failed", stage: row.error_stage || "runtime" }
      : null
  };
  if (row.status === "ready") {
    out.result_url = `${base}/result`;
    if (result?.artifacts?.thumbnail) out.thumbnail_url = `${base}/thumbnail`;
    if (result?.artifacts?.input_cutout) out.input_url = `${base}/input`;
  }
  if (row.status === "queued" && db) {
    const ahead = jobsAhead(row.id);
    out.queue = { position: ahead, ahead, eta_ms: ahead * avgDurationMs(db) };
  }
  return out;
}

export function registerMeshRoutes(app) {
  app.get("/api/mesh/health", async () => {
    const gpu = await detectGpu();
    return {
      ok: true,
      service: "mesh-api",
      gpu,
      engines: INSTALLED_ENGINES,
      default_engine: DEFAULT_ENGINE,
      // Capability discovery — clients should branch on these, not assume.
      phase: 1,
      rig_available: false, // Phase 2 (mesh -> VRM); /jobs/:id/rig returns 501 until then
      max_image_bytes: MAX_IMAGE_BYTES,
      ...getQueueState()
    };
  });

  app.post("/api/mesh/jobs", async (request, reply) => {
    const file = await request.file({ limits: { fileSize: MAX_IMAGE_BYTES } });
    if (!file) return reply.code(400).send({ error: "Missing image file" });
    if (!isSupportedImage(file.mimetype)) {
      return reply.code(415).send({ error: `Unsupported image type '${file.mimetype}'. Use PNG, JPEG, or WebP.` });
    }

    let buffer;
    try { buffer = await file.toBuffer(); } catch { return reply.code(413).send({ error: "Image exceeds 25 MB limit" }); }
    if (file.file?.truncated) return reply.code(413).send({ error: "Image exceeds 25 MB limit" });

    const fields = file.fields || {};
    const engine = fields.engine?.value || DEFAULT_ENGINE;
    if (!MESH_ENGINES.includes(engine)) return reply.code(400).send({ error: `Unknown engine '${engine}'` });
    if (!INSTALLED_ENGINES.includes(engine)) {
      return reply.code(409).send({ error: `Engine '${engine}' is not installed yet. Installed: ${INSTALLED_ENGINES.join(", ")}` });
    }

    const params = {
      remove_bg: parseBool(fields.remove_bg?.value, true),
      texture: parseBool(fields.texture?.value, true),
      normalize: parseBool(fields.normalize?.value, true)
    };

    const db = getDb();
    ensureMeshColumns(db);

    // Idempotency: identical image+params -> return the existing job, no re-run.
    const sha = computeJobSha(buffer, engine, params);
    const existing = db
      .prepare("SELECT * FROM mesh_jobs WHERE sha256 = ? AND status != 'failed' ORDER BY created_at DESC LIMIT 1")
      .get(sha);
    if (existing) {
      return reply.code(200).send({ job_id: existing.id, status: existing.status, engine, deduped: true });
    }

    const jobId = newMeshJobId();
    const sourcePath = saveUploadedImage(buffer, jobId, file.mimetype, file.filename);
    db.prepare(`
      INSERT INTO mesh_jobs (id, status, stage, engine, source_path, params_json, sha256, progress)
      VALUES (?, 'queued', 'mesh', ?, ?, ?, ?, 0)
    `).run(jobId, engine, sourcePath, JSON.stringify(params), sha);

    enqueueMeshJob(jobId);
    return reply.code(201).send({ job_id: jobId, status: "queued", engine, deduped: false });
  });

  app.get("/api/mesh/jobs", async () => {
    const db = getDb();
    const rows = db.prepare("SELECT * FROM mesh_jobs ORDER BY created_at DESC").all();
    return { jobs: rows.map((r) => serializeJob(r, db)) };
  });

  app.get("/api/mesh/jobs/:id", async (request, reply) => {
    const db = getDb();
    const job = db.prepare("SELECT * FROM mesh_jobs WHERE id = ?").get(request.params.id);
    if (!job) return reply.code(404).send({ error: "Job not found" });
    return { job: serializeJob(job, db) };
  });

  app.get("/api/mesh/jobs/:id/result", async (request, reply) => {
    const db = getDb();
    const job = db.prepare("SELECT * FROM mesh_jobs WHERE id = ?").get(request.params.id);
    if (!job) return reply.code(404).send({ error: "Job not found" });
    if (job.status !== "ready") return reply.code(409).send({ error: `Job not ready (status: ${job.status})` });
    const path = meshResultPath(job.id);
    if (!existsSync(path)) return reply.code(404).send({ error: "Result file missing" });

    const etag = safeParse(job.result_json)?.sha256;
    if (etag && request.headers["if-none-match"] === `"${etag}"`) return reply.code(304).send();
    reply.header("Content-Type", "model/gltf-binary");
    reply.header("Content-Length", statSync(path).size);
    if (etag) reply.header("ETag", `"${etag}"`);
    reply.header("Content-Disposition", `inline; filename="${job.id}.glb"`);
    return reply.send(createReadStream(path));
  });

  const sendPng = (reply, path) => {
    if (!existsSync(path)) return reply.code(404).send({ error: "Not available" });
    reply.header("Content-Type", "image/png");
    reply.header("Content-Length", statSync(path).size);
    return reply.send(createReadStream(path));
  };
  app.get("/api/mesh/jobs/:id/thumbnail", async (request, reply) => sendPng(reply, meshThumbnailPath(request.params.id)));
  app.get("/api/mesh/jobs/:id/input", async (request, reply) => sendPng(reply, meshInputCutoutPath(request.params.id)));

  app.delete("/api/mesh/jobs/:id", async (request, reply) => {
    const db = getDb();
    const job = db.prepare("SELECT id, status FROM mesh_jobs WHERE id = ?").get(request.params.id);
    if (!job) return reply.code(404).send({ error: "Job not found" });
    if (job.status === "running" || job.status === "queued") {
      return reply.code(409).send({ error: `Job is ${job.status}` });
    }
    db.prepare("DELETE FROM mesh_jobs WHERE id = ?").run(job.id);
    deleteMeshAssets(job.id);
    return reply.code(204).send();
  });

  // Phase 2 (mesh -> VRM): contract reserved, not implemented yet.
  app.post("/api/mesh/jobs/:id/rig", async (_req, reply) =>
    reply.code(501).send({ error: "Phase 2 (rig -> VRM) not implemented yet" })
  );
  app.get("/api/mesh/jobs/:id/vrm", async (_req, reply) =>
    reply.code(501).send({ error: "Phase 2 (rig -> VRM) not implemented yet" })
  );
}
