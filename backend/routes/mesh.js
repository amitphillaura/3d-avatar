/**
 * Photo -> 3D mesh proxy.
 *
 * The actual mesh engine (TripoSR) runs on a remote Windows machine reachable
 * only over Tailscale. We proxy through this local backend so the browser stays
 * same-origin (no tailnet CORS), the remote host lives in ONE config point, and
 * we can degrade cleanly when the remote is offline.
 *
 * Contract mirrored from the remote service:
 *   GET    /api/mesh/health
 *   GET    /api/mesh/jobs
 *   POST   /api/mesh/jobs            (multipart: image, [engine, remove_bg, texture])
 *   GET    /api/mesh/jobs/:id
 *   GET    /api/mesh/jobs/:id/result (streams result.glb)
 *   DELETE /api/mesh/jobs/:id
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_ROOT } from "../lib/paths.js";

const PRIMARY = process.env.MESH_REMOTE_BASE || "http://amitlaptop:5190";
const FALLBACK = process.env.MESH_REMOTE_FALLBACK || "http://100.83.31.91:5190";
// MagicDNS first, Tailscale IP as fallback when DNS doesn't resolve.
const BASES = [...new Set([PRIMARY, FALLBACK].filter(Boolean))];
const MESH_CACHE = join(DATA_ROOT, "mesh");

function ensureCacheDir() {
  if (!existsSync(MESH_CACHE)) mkdirSync(MESH_CACHE, { recursive: true });
}

/**
 * Try each base URL until one *connects*. A network error (remote offline /
 * off the tailnet) falls through to the next base; an HTTP response — even a
 * 4xx/5xx — counts as "reached" and is returned to the caller as-is.
 * Throws an error tagged `offline` when no base can be reached.
 */
async function reachRemote(pathAndQuery, { timeoutMs = 30000, ...init } = {}) {
  let lastErr;
  for (const base of BASES) {
    try {
      return {
        base,
        resp: await fetch(base + pathAndQuery, { ...init, signal: AbortSignal.timeout(timeoutMs) })
      };
    } catch (err) {
      lastErr = err;
    }
  }
  const e = new Error(`mesh service unreachable: ${lastErr?.message || "no bases configured"}`);
  e.offline = true;
  throw e;
}

function sendProxyError(reply, err) {
  if (err.offline) {
    return reply.code(503).send({ error: "mesh-service-offline", base: PRIMARY, detail: err.message });
  }
  return reply.code(502).send({ error: "mesh-proxy-error", detail: err.message });
}

// Forward a simple JSON endpoint verbatim (status + body), so new fields the
// remote adds later pass straight through without code changes here.
async function passthrough(reply, pathAndQuery, init) {
  try {
    const { resp } = await reachRemote(pathAndQuery, init);
    const body = await resp.text();
    return reply
      .code(resp.status)
      .header("content-type", resp.headers.get("content-type") || "application/json")
      .send(body);
  } catch (err) {
    return sendProxyError(reply, err);
  }
}

export function registerMeshRoutes(app) {
  app.get("/api/mesh/health", (_req, reply) => passthrough(reply, "/api/mesh/health", { timeoutMs: 8000 }));

  app.get("/api/mesh/jobs", (_req, reply) => passthrough(reply, "/api/mesh/jobs"));

  app.get("/api/mesh/jobs/:id", (req, reply) =>
    passthrough(reply, `/api/mesh/jobs/${encodeURIComponent(req.params.id)}`));

  app.delete("/api/mesh/jobs/:id", (req, reply) =>
    passthrough(reply, `/api/mesh/jobs/${encodeURIComponent(req.params.id)}`, { method: "DELETE" }));

  // Submit a job: re-stream the uploaded image (plus optional fields) to the remote.
  app.post("/api/mesh/jobs", async (request, reply) => {
    const form = new FormData();
    let hasImage = false;
    try {
      for await (const part of request.parts()) {
        if (part.type === "file") {
          const buf = await part.toBuffer();
          form.append(
            "image",
            new Blob([buf], { type: part.mimetype || "application/octet-stream" }),
            part.filename || "upload"
          );
          hasImage = true;
        } else {
          form.append(part.fieldname, String(part.value));
        }
      }
    } catch (err) {
      return reply.code(400).send({ error: "bad-multipart", detail: err.message });
    }
    if (!hasImage) return reply.code(400).send({ error: "image field required" });

    try {
      const { resp } = await reachRemote("/api/mesh/jobs", { method: "POST", body: form, timeoutMs: 60000 });
      const body = await resp.text();
      return reply
        .code(resp.status)
        .header("content-type", resp.headers.get("content-type") || "application/json")
        .send(body);
    } catch (err) {
      return sendProxyError(reply, err);
    }
  });

  // Stream (and cache) the result GLB. We buffer it so we can add a
  // Content-Length the remote currently omits, and keep a local copy under
  // data/mesh/ for re-preview without a round-trip.
  app.get("/api/mesh/jobs/:id/result", async (request, reply) => {
    const id = request.params.id;
    try {
      const { resp } = await reachRemote(`/api/mesh/jobs/${encodeURIComponent(id)}/result`, { timeoutMs: 60000 });
      if (!resp.ok) {
        return reply.code(resp.status).send(await resp.text());
      }
      const buf = Buffer.from(await resp.arrayBuffer());
      try {
        ensureCacheDir();
        writeFileSync(join(MESH_CACHE, `${id}.glb`), buf);
      } catch {
        /* cache is best-effort */
      }
      return reply
        .code(200)
        .header("content-type", "model/gltf-binary")
        .header("content-length", String(buf.length))
        .header("content-disposition", `inline; filename="${id}.glb"`)
        .send(buf);
    } catch (err) {
      return sendProxyError(reply, err);
    }
  });
}
