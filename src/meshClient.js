// Browser client for the mesh API (photo -> 3D .glb).
// Submit an image, poll the job to completion, then load result.glb.
//
//   import { submitMesh, pollMeshJob, meshResultUrl } from "./meshClient.js";
//   const { job_id } = await submitMesh(file, { engine: "triposr" });
//   const job = await pollMeshJob(job_id, { onStatus: (j) => console.log(j.status) });
//   loader.load(meshResultUrl(job_id), (gltf) => scene.add(gltf.scene));

const API_BASE = ""; // same-origin (matches src/motion.js); set when calling cross-host

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, options);
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : null;
  if (!response.ok) {
    throw new Error(payload?.error || `Request failed (${response.status})`);
  }
  if (response.status === 204) return null;
  return payload;
}

/** GET /api/mesh/health -> { ok, gpu, engines, default_engine }. */
export function meshHealth() {
  return api("/api/mesh/health");
}

/**
 * POST /api/mesh/jobs (multipart). `image` is a File/Blob.
 * opts: { engine?, removeBg?, texture? } -> { job_id, status, engine }.
 */
export function submitMesh(image, opts = {}) {
  const form = new FormData();
  form.append("image", image, image.name || "image.png");
  if (opts.engine) form.append("engine", opts.engine);
  if (opts.removeBg !== undefined) form.append("remove_bg", String(opts.removeBg));
  if (opts.texture !== undefined) form.append("texture", String(opts.texture));
  return api("/api/mesh/jobs", { method: "POST", body: form });
}

/** GET /api/mesh/jobs/:id -> { job }. */
export async function getMeshJob(jobId) {
  const { job } = await api(`/api/mesh/jobs/${jobId}`);
  return job;
}

/** GET /api/mesh/jobs -> array of jobs. */
export async function listMeshJobs() {
  const { jobs } = await api("/api/mesh/jobs");
  return jobs;
}

/** DELETE /api/mesh/jobs/:id. */
export function deleteMeshJob(jobId) {
  return api(`/api/mesh/jobs/${jobId}`, { method: "DELETE" });
}

/** Direct URL for the finished GLB (stream, model/gltf-binary). */
export function meshResultUrl(jobId) {
  return `${API_BASE}/api/mesh/jobs/${jobId}/result`;
}

/**
 * Poll a job until it reaches a terminal state (ready|failed) or times out.
 * opts: { intervalMs=1500, timeoutMs=180000, onStatus }.
 * Resolves with the ready job; throws on failed/timeout.
 */
export async function pollMeshJob(jobId, opts = {}) {
  const { intervalMs = 1500, timeoutMs = 180000, onStatus } = opts;
  const deadline = Date.now() + timeoutMs;
  let last = null;
  for (;;) {
    const job = await getMeshJob(jobId);
    if (onStatus && job.status !== last) onStatus(job);
    last = job.status;
    if (job.status === "ready") return job;
    if (job.status === "failed") throw new Error(job.error || "Mesh job failed");
    if (Date.now() > deadline) throw new Error("Timed out waiting for mesh job");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
