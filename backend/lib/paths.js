import { mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const PROJECT_ROOT = root;
export const DATA_ROOT = join(root, "data");
export const VIDEOS_ROOT = join(DATA_ROOT, "videos");
export const MESH_ROOT = join(DATA_ROOT, "mesh");
export const DB_PATH = join(DATA_ROOT, "motion.db");

export function videoDir(videoId) {
  return join(VIDEOS_ROOT, videoId);
}

export function videoSourcePath(videoId, filename = "source") {
  return join(videoDir(videoId), `${filename}`);
}

export function rawLandmarksPath(videoId) {
  return join(videoDir(videoId), "raw.jsonl");
}

export function processedLandmarksPath(videoId) {
  return join(videoDir(videoId), "processed.jsonl");
}

export function matrixPath(videoId, segmentId) {
  return join(videoDir(videoId), "matrices", `${segmentId}.json`);
}

export function ensureDataDirs() {
  for (const dir of [DATA_ROOT, VIDEOS_ROOT]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}

// --- Mesh API (photo -> 3D) -------------------------------------------------
// Files live under data/mesh/<jobId>/ : source<ext>, result.glb, result.vrm.

export function meshJobDir(jobId) {
  return join(MESH_ROOT, jobId);
}

export function meshSourcePath(jobId, ext = "") {
  return join(meshJobDir(jobId), `source${ext}`);
}

export function meshResultPath(jobId) {
  return join(meshJobDir(jobId), "result.glb");
}

export function meshVrmPath(jobId) {
  return join(meshJobDir(jobId), "result.vrm");
}

export function ensureMeshDirs() {
  for (const dir of [DATA_ROOT, MESH_ROOT]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}

export function ensureMeshJobDir(jobId) {
  ensureMeshDirs();
  const dir = meshJobDir(jobId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function ensureVideoDir(videoId) {
  ensureDataDirs();
  const dir = videoDir(videoId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const matrices = join(dir, "matrices");
  if (!existsSync(matrices)) mkdirSync(matrices, { recursive: true });
  return dir;
}
