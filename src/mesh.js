/**
 * Photo -> 3D controller.
 *
 * Talks to the local backend proxy at /api/mesh (which forwards to the remote
 * TripoSR service over Tailscale). Designed to degrade gracefully: if the
 * server doesn't yet send `progress` or `result` stats, we show an
 * indeterminate bar and parse the GLB ourselves for vertex/face counts.
 */
import { MeshViewer } from "./meshViewer.js";

const API = "/api/mesh";

let viewer = null;
let selectedFile = null;
let polling = false;
let downloadUrl = null;

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (n) => (n == null ? "?" : Math.round(n).toLocaleString());

// fetch() rejects with a TypeError (not an HTTP status) when the local backend
// is down; the proxy returns 503 when the *remote* engine is unreachable.
function isOffline(err) {
  return err instanceof TypeError || /Failed to fetch|NetworkError|Load failed/i.test(err?.message || "");
}

function setHealth(text, state) {
  const el = $("mesh-health");
  if (!el) return;
  el.textContent = text;
  el.dataset.state = state;
}

async function checkHealth() {
  try {
    const r = await fetch(`${API}/health`);
    if (r.status === 503) {
      setHealth("Service offline — start the mesh engine on amitlaptop", "offline");
      return false;
    }
    if (!r.ok) {
      setHealth(`Service error ${r.status}`, "error");
      return false;
    }
    const h = await r.json();
    setHealth(`Ready · ${h.gpu || h.default_engine || "GPU"}`, "ok");
    return true;
  } catch (err) {
    setHealth(isOffline(err) ? "Backend offline — run npm run backend" : `Error: ${err.message}`, "offline");
    return false;
  }
}

function selectFile(file) {
  if (!file) return;
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
    $("mesh-status").textContent = "Please choose a PNG, JPEG, or WebP image.";
    return;
  }
  selectedFile = file;
  const img = $("mesh-preview-img");
  img.src = URL.createObjectURL(file);
  img.hidden = false;
  $("mesh-drop").hidden = true;
  $("mesh-generate").disabled = false;
  $("mesh-status").textContent = `Selected ${file.name}. Click Generate 3D.`;
}

// --- progress bar (determinate when we have a %, else indeterminate) ---
function showProgress(pct, indeterminate) {
  const wrap = $("mesh-progress-wrap");
  const bar = $("mesh-progress-bar");
  if (!wrap || !bar) return;
  wrap.hidden = false;
  wrap.classList.toggle("is-indeterminate", !!indeterminate);
  bar.style.width = indeterminate ? "100%" : `${Math.max(0, Math.min(100, pct))}%`;
}
function hideProgress() {
  const wrap = $("mesh-progress-wrap");
  if (wrap) wrap.hidden = true;
}

function setBusy(busy) {
  $("mesh-generate").disabled = busy || !selectedFile;
  $("mesh-file").disabled = busy;
}

// --- minimal GLB validation + stat extraction (fallback when the server
//     doesn't return result stats yet) ---
function inspectGlb(buffer) {
  const dv = new DataView(buffer);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== "glTF") return { valid: false };
  const out = { valid: true, vertices: 0, triangles: 0, hasTexture: false, vertexColors: false };
  try {
    const jsonLen = dv.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLen)));
    const acc = json.accessors || [];
    out.hasTexture = (json.textures || []).length > 0;
    (json.meshes || []).forEach((m) =>
      (m.primitives || []).forEach((p) => {
        const pos = p.attributes?.POSITION;
        if (pos != null && acc[pos]) out.vertices += acc[pos].count;
        if (p.indices != null && acc[p.indices]) out.triangles += acc[p.indices].count / 3;
        if (p.attributes?.COLOR_0 != null) out.vertexColors = true;
      })
    );
  } catch {
    /* header is valid even if we can't parse stats */
  }
  return out;
}

async function generate() {
  if (!selectedFile || polling) return;
  const status = $("mesh-status");

  const fd = new FormData();
  fd.append("image", selectedFile);
  fd.append("engine", "triposr");
  fd.append("remove_bg", String($("mesh-remove-bg").checked));
  fd.append("texture", String($("mesh-texture").checked));

  setBusy(true);
  $("mesh-result-meta").hidden = true;
  $("mesh-download").hidden = true;
  status.textContent = "Submitting…";

  try {
    const r = await fetch(`${API}/jobs`, { method: "POST", body: fd });
    if (r.status === 503) {
      status.textContent = "Mesh service offline.";
      setBusy(false);
      return;
    }
    if (!r.ok) {
      status.textContent = `Submit failed (${r.status}).`;
      setBusy(false);
      return;
    }
    const job = await r.json();
    const id = job.job_id || job.id;
    if (!id) {
      status.textContent = "Submit returned no job id.";
      setBusy(false);
      return;
    }
    await pollJob(id);
  } catch (err) {
    status.textContent = isOffline(err) ? "Backend offline." : `Error: ${err.message}`;
    setBusy(false);
  }
}

async function pollJob(id) {
  polling = true;
  const status = $("mesh-status");
  const start = Date.now();
  const TIMEOUT_MS = 4 * 60 * 1000;
  showProgress(0, true);

  while (Date.now() - start < TIMEOUT_MS) {
    await sleep(2500);
    let job;
    try {
      const r = await fetch(`${API}/jobs/${id}`);
      if (!r.ok) {
        status.textContent = `Status check failed (${r.status}).`;
        break;
      }
      const data = await r.json();
      job = data.job || data;
    } catch (err) {
      status.textContent = isOffline(err) ? "Backend offline." : `Error: ${err.message}`;
      break;
    }

    const secs = Math.round((Date.now() - start) / 1000);
    const pct = typeof job.progress === "number" ? job.progress : null;

    if (job.status === "ready") {
      showProgress(100, false);
      await onReady(id, job, secs);
      polling = false;
      setBusy(false);
      return;
    }
    if (job.status === "failed") {
      status.textContent = `Failed: ${job.error?.message || job.error || "unknown error"}`;
      hideProgress();
      polling = false;
      setBusy(false);
      return;
    }

    status.textContent = `${job.status}${pct != null ? ` ${pct}%` : ""} · ${secs}s`;
    if (pct != null) showProgress(pct, false);
    else showProgress(0, true);
  }

  if (polling) {
    status.textContent = "Timed out waiting for the mesh.";
    hideProgress();
    polling = false;
    setBusy(false);
  }
}

async function onReady(id, job, secs) {
  const status = $("mesh-status");
  status.textContent = `Ready in ${secs}s — loading preview…`;
  try {
    const r = await fetch(`${API}/jobs/${id}/result`);
    if (!r.ok) {
      status.textContent = `Download failed (${r.status}).`;
      return;
    }
    const buffer = await r.arrayBuffer();
    const local = inspectGlb(buffer);
    if (!local.valid) {
      status.textContent = "Downloaded file is not a valid glTF.";
      return;
    }

    if (!viewer) viewer = new MeshViewer($("mesh-canvas"));
    await viewer.loadArrayBuffer(buffer);

    // Download link
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    downloadUrl = URL.createObjectURL(new Blob([buffer], { type: "model/gltf-binary" }));
    const dl = $("mesh-download");
    dl.href = downloadUrl;
    dl.download = `${id.slice(0, 8)}.glb`;
    dl.hidden = false;

    // Prefer server-provided stats; fall back to our own parse.
    const res = job.result || {};
    const verts = res.vertices ?? local.vertices;
    const tris = res.triangles ?? local.triangles;
    const textured = res.has_texture ?? local.hasTexture;
    const meta = $("mesh-result-meta");
    meta.hidden = false;
    meta.innerHTML =
      `<strong>Mesh ready</strong> · ${(buffer.byteLength / 1048576).toFixed(2)} MB · ` +
      `${fmt(verts)} verts · ${fmt(tris)} tris · ${textured ? "textured" : "vertex colors"}`;
    status.textContent = `Done in ${secs}s. Drag to orbit.`;
  } catch (err) {
    status.textContent = `Preview error: ${err.message}`;
  }
}

function wireDropZone() {
  const drop = $("mesh-drop");
  if (!drop) return;
  ["dragenter", "dragover"].forEach((ev) =>
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.add("is-drag");
    })
  );
  ["dragleave", "drop"].forEach((ev) =>
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.remove("is-drag");
    })
  );
  drop.addEventListener("drop", (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (file) selectFile(file);
  });
}

export function initMesh() {
  const fileInput = $("mesh-file");
  const generateBtn = $("mesh-generate");
  if (!fileInput || !generateBtn) return; // view not present

  fileInput.addEventListener("change", () => selectFile(fileInput.files[0]));
  generateBtn.addEventListener("click", generate);
  wireDropZone();

  // Lazily create the viewer and re-check health when the view is opened, so we
  // don't spin up WebGL on the home screen.
  $("card-mesh")?.addEventListener("click", () => {
    checkHealth();
    if (viewer) viewer.resize();
  });

  checkHealth();
}
