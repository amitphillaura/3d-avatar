import { existsSync, renameSync, unlinkSync, copyFileSync, statSync, readdirSync } from "node:fs";
import { extname, resolve, join, basename } from "node:path";
import { homedir } from "node:os";
import { getDb } from "../db/index.js";
import { newVideoId, processVideoJob, sha256File } from "../lib/processor.js";
import { ensureVideoDir, videoDir } from "../lib/paths.js";

const VIDEO_EXTS = new Set([".mp4", ".mov", ".avi", ".webm", ".mkv", ".m4v"]);
const ALLOWED_ROOT = resolve(process.env.FILES_ROOT || join(homedir(), "Downloads"));

function ensureProgressColumn(db) {
  const cols = db.prepare("PRAGMA table_info(videos)").all();
  if (!cols.find((c) => c.name === "processing_progress")) {
    db.prepare("ALTER TABLE videos ADD COLUMN processing_progress INTEGER").run();
  }
}

function validatePath(reqPath) {
  const target = reqPath ? resolve(reqPath) : ALLOWED_ROOT;
  // Add sep to prevent /Downloads2 from matching /Downloads
  if (target !== ALLOWED_ROOT && !target.startsWith(ALLOWED_ROOT + "/")) {
    return { error: "Path is outside allowed root", target: null };
  }
  return { error: null, target };
}

export function registerFileRoutes(app) {
  // GET /api/files/browse
  app.get("/api/files/browse", async (request, reply) => {
    const { path: pathParam } = request.query || {};
    const { error, target } = validatePath(pathParam);
    if (error) return reply.code(403).send({ error });

    if (!existsSync(target)) {
      return reply.code(404).send({ error: "Path not found" });
    }

    const stat = statSync(target);
    if (!stat.isDirectory()) {
      return reply.code(400).send({ error: "Path is not a directory" });
    }

    const rawEntries = readdirSync(target, { withFileTypes: true });
    const entries = [];

    for (const ent of rawEntries) {
      if (ent.isDirectory()) {
        entries.push({ name: ent.name, isDir: true, path: join(target, ent.name) });
      } else if (ent.isFile()) {
        const ext = extname(ent.name).toLowerCase();
        if (VIDEO_EXTS.has(ext)) {
          let size;
          try {
            size = statSync(join(target, ent.name)).size;
          } catch {
            size = null;
          }
          entries.push({ name: ent.name, isDir: false, size, path: join(target, ent.name) });
        }
      }
    }

    // Sort: dirs first, then files, both alphabetically
    entries.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return reply.send({ root: ALLOWED_ROOT, path: target, entries });
  });

  // POST /api/videos/import-by-path
  app.post("/api/videos/import-by-path", async (request, reply) => {
    const { path: filePath } = request.body || {};
    if (!filePath) return reply.code(400).send({ error: "path is required" });

    const { error, target } = validatePath(filePath);
    if (error) return reply.code(403).send({ error });

    if (!existsSync(target)) {
      return reply.code(404).send({ error: "File not found" });
    }

    const ext = extname(target).toLowerCase();
    if (!VIDEO_EXTS.has(ext)) {
      return reply.code(400).send({ error: "Not a supported video file" });
    }

    const sha256 = await sha256File(target);
    const db = getDb();
    ensureProgressColumn(db);

    const existing = db.prepare("SELECT id FROM videos WHERE sha256 = ?").get(sha256);
    if (existing) {
      return reply.code(409).send({ error: "Already imported", videoId: existing.id });
    }

    const videoId = newVideoId();
    ensureVideoDir(videoId);

    const destPath = join(videoDir(videoId), `source${ext}`);
    // Move file (EXDEV-safe)
    try {
      renameSync(target, destPath);
    } catch (err) {
      if (err.code === "EXDEV") {
        copyFileSync(target, destPath);
        unlinkSync(target);
      } else {
        throw err;
      }
    }

    const filename = basename(target);
    db.prepare(`
      INSERT INTO videos (id, filename, sha256, source_path, rig_variant, tracking_mode, status)
      VALUES (?, ?, ?, ?, 'mushy', 'both', 'uploaded')
    `).run(videoId, filename, sha256, destPath);

    const videoRow = db.prepare("SELECT * FROM videos WHERE id = ?").get(videoId);

    processVideoJob({
      db,
      videoId: videoRow.id,
      sourcePath: videoRow.source_path,
      rigVariant: videoRow.rig_variant,
      trackingMode: videoRow.tracking_mode,
      width: videoRow.width,
      height: videoRow.height
    }).catch((err) => {
      console.error(`Processing failed for ${videoId}:`, err.message);
    });

    return reply.code(201).send({ videoId, filename });
  });

  // GET /api/queue
  app.get("/api/queue", async (_request, reply) => {
    const db = getDb();
    ensureProgressColumn(db);

    const rows = db.prepare(`
      SELECT id, filename, status, processing_progress, created_at
      FROM videos
      WHERE status IN ('uploaded', 'processing', 'ready', 'failed')
      ORDER BY created_at DESC
      LIMIT 50
    `).all();

    const jobs = rows.map((r) => ({
      id: r.id,
      filename: r.filename,
      status: r.status,
      progress: r.processing_progress ?? null,
      created_at: r.created_at
    }));

    return reply.send({ jobs });
  });
}
