/**
 * Photo -> 3D controller.
 *
 * Talks to the local backend proxy at /api/mesh (which forwards to the remote
 * mesh service over Tailscale). Two modes:
 *   - Fast: TripoSR (~1 min, soft "clay" quality)
 *   - High Quality: SF3D / Hunyuan3D — lights up automatically once the engine
 *     shows up in /health.engines (built separately on the GPU box).
 *
 * Degrades gracefully: if the server omits `progress`/`result` stats we show an
 * indeterminate bar and parse the GLB ourselves.
 */
import { MeshViewer } from "./meshViewer.js";

const API = "/api/mesh";

let viewer = null;
let selectedFile = null;
let polling = false;
let downloadUrl = null;
let mode = "fast"; // 'fast' | 'hq'
let availableEngines = ["triposr"]; // from /health

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (n) => (n == null ? "?" : Math.round(n).toLocaleString());

function isOffline(err) {
  return err instanceof TypeError || /Failed to fetch|NetworkError|Load failed/i.test(err?.message || "");
}

function setHealth(text, state) {
  const el = $("mesh-health");
  if (!el) return;
  el.textContent = text;
  el.dataset.state = state;
}

// The engine the current mode will submit with.
function currentEngine() {
  return mode === "fast" ? "triposr" : $("mesh-hq-engine")?.value || "sf3d";
}

// Is the chosen engine actually installed on the server right now?
function engineReady() {
  return availableEngines.includes(currentEngine());
}

async function checkHealth() {
  try {
    const r = await fetch(`${API}/health`);
    if (r.status === 503) {
      setHealth("Service offline — start the mesh engine on the GPU box", "offline");
      availableEngines = [];
      refreshModeUI();
      return false;
    }
    if (!r.ok) {
      setHealth(`Service error ${r.status}`, "error");
      return false;
    }
    const h = await r.json();
    availableEngines = Array.isArray(h.engines) ? h.engines : ["triposr"];
    setHealth(`Ready · ${h.gpu || h.default_engine || "GPU"}`, "ok");
    refreshModeUI();
    return true;
  } catch (err) {
    setHealth(isOffline(err) ? "Backend offline — run npm run backend" : `Error: ${err.message}`, "offline");
    availableEngines = [];
    refreshModeUI();
    return false;
  }
}

// --- mode (tab) handling -------------------------------------------------- //
function setMode(next) {
  mode = next;
  $("mesh-tab-fast").classList.toggle("is-active", next === "fast");
  $("mesh-tab-hq").classList.toggle("is-active", next === "hq");
  $("mesh-tab-fast").setAttribute("aria-selected", String(next === "fast"));
  $("mesh-tab-hq").setAttribute("aria-selected", String(next === "hq"));
  $("mesh-hq-engine-field").hidden = next !== "hq";
  refreshModeUI();
}

function refreshModeUI() {
  const note = $("mesh-mode-note");
  const unavail = $("mesh-hq-unavailable");
  if (mode === "fast") {
    if (note) note.textContent = 'Fast preview — soft "clay" geometry, vertex colors.';
    unavail.hidden = true;
  } else {
    if (note) note.textContent = "Higher fidelity — UV-textured, much cleaner on people.";
    if (!engineReady()) {
      unavail.hidden = false;
      unavail.innerHTML =
        `<strong>${currentEngine()}</strong> isn't built yet — it's being added on the GPU box. ` +
        `This panel lights up automatically once the engine reports in. ` +
        `<span class="mesh-unavailable-hint">(server engines: ${availableEngines.join(", ") || "none"})</span>`;
    } else {
      unavail.hidden = true;
    }
  }
  updateGenerateEnabled();
}

function updateGenerateEnabled() {
  $("mesh-generate").disabled = polling || !selectedFile || !engineReady();
}

// --- file selection ------------------------------------------------------- //
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
  $("mesh-result-meta").hidden = true;
  $("mesh-download").hidden = true;
  $("mesh-new").hidden = true;
  $("mesh-status").textContent = `Selected ${file.name}. Click Generate 3D.`;
  updateGenerateEnabled();
}

// Reset the picker so it's obvious how to run another image.
function resetForNewImage() {
  selectedFile = null;
  $("mesh-file").value = "";
  $("mesh-preview-img").hidden = true;
  $("mesh-drop").hidden = false;
  $("mesh-result-meta").hidden = true;
  $("mesh-download").hidden = true;
  $("mesh-new").hidden = true;
  hideProgress();
  $("mesh-status").textContent = "Pick a photo to start.";
  updateGenerateEnabled();
}

// --- progress ------------------------------------------------------------- //
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
  polling = busy;
  $("mesh-file").disabled = busy;
  $("mesh-tab-fast").disabled = busy;
  $("mesh-tab-hq").disabled = busy;
  updateGenerateEnabled();
}

// --- GLB stat fallback ---------------------------------------------------- //
function inspectGlb(buffer) {
  const dv = new DataView(buffer);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== "glTF") return { valid: false };
  const out = { valid: true, vertices: 0, triangles: 0, hasTexture: false };
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
      })
    );
  } catch {
    /* header valid even if stats unparsed */
  }
  return out;
}

// --- generate / poll ------------------------------------------------------ //
async function generate() {
  if (!selectedFile || polling || !engineReady()) return;
  const status = $("mesh-status");
  const engine = currentEngine();

  const fd = new FormData();
  fd.append("image", selectedFile);
  fd.append("engine", engine);
  fd.append("remove_bg", String($("mesh-remove-bg").checked));
  fd.append("texture", "true");

  setBusy(true);
  $("mesh-result-meta").hidden = true;
  $("mesh-download").hidden = true;
  $("mesh-new").hidden = true;
  status.textContent = `Submitting (${engine})…`;

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
    await pollJob(id, engine);
  } catch (err) {
    status.textContent = isOffline(err) ? "Backend offline." : `Error: ${err.message}`;
    setBusy(false);
  }
}

async function pollJob(id, engine) {
  const status = $("mesh-status");
  const start = Date.now();
  const TIMEOUT_MS = 6 * 60 * 1000; // HQ engines can be slower than TripoSR
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
      setBusy(false);
      return;
    }
    if (job.status === "failed") {
      status.textContent = `Failed: ${job.error?.message || job.error || "unknown error"}`;
      hideProgress();
      $("mesh-new").hidden = false;
      setBusy(false);
      return;
    }

    status.textContent = `${job.status} (${engine})${pct != null ? ` ${pct}%` : ""} · ${secs}s`;
    if (pct != null) showProgress(pct, false);
    else showProgress(0, true);
  }

  if (polling) {
    status.textContent = "Timed out waiting for the mesh.";
    hideProgress();
    $("mesh-new").hidden = false;
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
      $("mesh-new").hidden = false;
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

    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    downloadUrl = URL.createObjectURL(new Blob([buffer], { type: "model/gltf-binary" }));
    const dl = $("mesh-download");
    dl.href = downloadUrl;
    dl.download = `${id.slice(0, 8)}.glb`;
    dl.hidden = false;
    $("mesh-new").hidden = false; // make "run another" obvious

    const res = job.result || {};
    const verts = res.vertices ?? local.vertices;
    const tris = res.triangles ?? local.triangles;
    const textured = res.has_texture ?? local.hasTexture;
    const meta = $("mesh-result-meta");
    meta.hidden = false;
    meta.innerHTML =
      `<strong>Mesh ready</strong> · ${(buffer.byteLength / 1048576).toFixed(2)} MB · ` +
      `${fmt(verts)} verts · ${fmt(tris)} tris · ${textured ? "textured" : "vertex colors"}`;
    status.textContent = `Done in ${secs}s. Drag to orbit, or “New image”.`;
  } catch (err) {
    status.textContent = `Preview error: ${err.message}`;
    $("mesh-new").hidden = false;
  }
}

// --- drop zone ------------------------------------------------------------ //
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
  $("mesh-new").addEventListener("click", resetForNewImage);
  $("mesh-tab-fast").addEventListener("click", () => setMode("fast"));
  $("mesh-tab-hq").addEventListener("click", () => setMode("hq"));
  $("mesh-hq-engine").addEventListener("change", refreshModeUI);
  wireDropZone();

  $("card-mesh")?.addEventListener("click", () => {
    checkHealth();
    if (viewer) viewer.resize();
  });

  setMode("fast");
  checkHealth();
}
