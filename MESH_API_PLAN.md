# Image → 3D Mesh → VRM API — Build Spec

Spec for adding a **photo → 3D model** service to this repo, served from a home
machine (Lenovo, **RTX 4070**) and called from the app over **Tailscale**.

This is a handoff doc for the Claude Code instance running **on the laptop**. It
matches the existing backend conventions (Fastify routes + `better-sqlite3` +
Python workers spawned from `backend/.venv`) — see `backend/server.js`,
`backend/routes/index.js`, `backend/lib/processor.js`, `backend/lib/paths.js`.

---

## Goal & phasing

**End goal:** photo → rigged humanoid **VRM** that the existing VRM editor can
drive with our `.vrma` animations.

Build in two phases. **Phase 1 is shippable on its own** — do not block it on
Phase 2.

- **Phase 1 — image → static textured mesh (`.glb`).** Self-contained, useful
  immediately (preview generated meshes in a Three.js viewer).
- **Phase 2 — mesh → animatable `.vrm`.** Auto-rig + VRM convert/retarget. This
  is the hard, unreliable part; treat it as a separate worker stage.

---

## Engine decision (RTX 4070)

Do **not** anchor on TripoSR despite the branch name. The 4070 can run better
engines. Build the API **engine-agnostic** (a config flag), so swapping is not a
rewrite — this is the single most important design choice.

| Engine | Role | VRAM | Notes |
|---|---|---|---|
| **TripoSR** | smoke test | ~4 GB / CPU-ok | Fastest to get running. Use first to prove the pipeline end-to-end, then move up. Lowest quality, unrigged, reproduces the photo's pose. |
| **Stable Fast 3D (SF3D)** | light/fast | ~6–7 GB | TripoSR's successor: UV-unwrapped, materials. Good default fallback. |
| **Hunyuan3D 2.1** | **primary** | ~8–12 GB | Best quality-per-VRAM in 2026; own texture-paint model. Target engine on the 4070. |

> TRELLIS (Microsoft) is excellent but wants ~16 GB — borderline on a 4070 (fine
> on 12 GB desktop, painful on 8 GB laptop). Skip unless you hit a quality wall.

**Reality check on the VRM goal:** every image-to-3D engine emits a *static,
unrigged* mesh in the photo's pose. None produce a VRM humanoid. Single-photo →
clean animatable VRM is reliable only for stylized/simple characters today. The
mesh step is ~30% of the work; rig → VRM → retarget is the other ~70%.

---

## Architecture

```
                 Tailscale tailnet
  App / Mac  ─────────────────────────▶  Lenovo (RTX 4070)
  meshClient    POST /api/mesh/jobs {image}     Fastify gateway (Node)
                GET  /api/mesh/jobs/{id}         │  jobs table (SQLite)
                GET  /api/mesh/jobs/{id}/result  │
                                                 ├─ Phase 1 worker (Python .venv)
                                                 │     rembg → engine → result.glb
                                                 └─ Phase 2 worker (Python + Blender)
                                                       auto-rig → VRM convert → result.vrm
```

Mirror the Motion API: a new route module registered in `backend/server.js`, a
jobs table, and Python workers spawned via `spawn(PYTHON_BIN, [...])` exactly
like `backend/lib/processor.js` does. **Use a job queue (submit → poll →
download), not a synchronous request** — Hunyuan3D + texturing can take
30s–2min, too long to hold an HTTP connection.

### Files to add

```
backend/routes/mesh.js          # Fastify routes (register in server.js)
backend/lib/mesh.js             # job lifecycle, spawn worker, paths, status
backend/worker/generate_mesh.py # Phase 1: image → .glb (engine adapters)
backend/worker/rig_to_vrm.py    # Phase 2: .glb → .vrm (Blender headless)
backend/lib/paths.js            # extend: MESH_ROOT, meshJobDir(), result paths
backend/db/schema.sql           # add mesh_jobs table
backend/requirements-mesh.txt   # engine deps (kept separate from motion deps)
src/meshClient.js               # browser client: submit image, poll, load GLB
```

---

## Data model — `mesh_jobs`

Add to `backend/db/schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS mesh_jobs (
  id           TEXT PRIMARY KEY,
  status       TEXT NOT NULL DEFAULT 'queued',  -- queued|running|ready|failed
  stage        TEXT NOT NULL DEFAULT 'mesh',    -- mesh|rig
  engine       TEXT NOT NULL,                   -- triposr|sf3d|hunyuan3d
  source_path  TEXT NOT NULL,                   -- uploaded image
  result_path  TEXT,                            -- result.glb (phase 1)
  vrm_path     TEXT,                            -- result.vrm (phase 2)
  error        TEXT,
  params_json  TEXT,                            -- {remove_bg, texture, ...}
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Files live under `data/mesh/<jobId>/` (extend `paths.js` with `MESH_ROOT`,
`meshJobDir(jobId)`, `meshResultPath(jobId)`, `meshVrmPath(jobId)`, and an
`ensureMeshDirs()` helper next to `ensureDataDirs()`).

On startup, recover stale jobs (mirror `recoverStaleProcessing`): any row left
`running` → mark `failed` (or re-queue).

---

## Endpoint contract (`/api/mesh/*`)

| Method | Path | Body / Query | Returns |
|---|---|---|---|
| `GET`  | `/api/mesh/health` | — | `{ ok, gpu, engines:[...] }` |
| `POST` | `/api/mesh/jobs` | multipart: `image` (file), fields: `engine?`, `remove_bg?`, `texture?` | `201 { job_id, status:"queued" }` |
| `GET`  | `/api/mesh/jobs` | — | `{ jobs:[...] }` |
| `GET`  | `/api/mesh/jobs/:id` | — | `{ job }` (status, error, stage) |
| `GET`  | `/api/mesh/jobs/:id/result` | — | `result.glb` (stream, `model/gltf-binary`) |
| `POST` | `/api/mesh/jobs/:id/rig` | — (Phase 2) | `202 { job_id, stage:"rig" }` |
| `GET`  | `/api/mesh/jobs/:id/vrm` | — (Phase 2) | `result.vrm` (stream) |
| `DELETE` | `/api/mesh/jobs/:id` | — | `204` |

Reuse the multipart upload pattern from `POST /api/videos` in
`backend/routes/index.js` (`request.file()`, `file.toBuffer()`, `file.fields`).
Default `engine` to `triposr` initially, switch to `hunyuan3d` once installed.

---

## Engine adapter interface (Python)

`backend/worker/generate_mesh.py` is invoked as a subprocess:

```
python3 generate_mesh.py --image <path> --output <result.glb> \
    --engine <triposr|sf3d|hunyuan3d> [--remove-bg] [--texture]
```

Internally dispatch on `--engine` to one adapter per model. Each adapter:
1. optional background removal (`rembg`),
2. run the model,
3. export a single `.glb` to `--output`,
4. print a JSON status line to stdout, non-zero exit on failure.

Keep adapters isolated so a missing engine never breaks the others. Spawn it from
`backend/lib/mesh.js` exactly like `processor.js` spawns `process_video.py`
(`PYTHON_BIN` = `backend/.venv/bin/python3` if present, else `python3`).

---

## Phase 2 — mesh → VRM (the hard part)

Run as a separate stage (`POST /api/mesh/jobs/:id/rig`) so Phase 1 stays usable.

1. **Pose:** image-to-3D reproduces the photo's pose; rigging wants T/A-pose.
   Mitigate by feeding T-pose reference photos, or re-pose in Blender first.
2. **Auto-rig:** **UniRig** (Tripo's open auto-rigger) or Mixamo → skeleton +
   skin weights.
3. **VRM convert/retarget:** **Blender + VRM add-on**, headless via
   `blender --background --python rig_to_vrm.py`. Map bones to VRM humanoid
   names; add blendshapes for expressions. (Blender headless is the most
   automatable path; budget the most time here.)
4. **Hook in:** a valid `.vrm` drops straight into the existing VRM editor +
   `.vrma` animation panel — no app changes needed.

---

## Laptop install checklist (RTX 4070)

1. **Driver/CUDA:** recent NVIDIA driver + CUDA 12.x. Verify `nvidia-smi`.
   - If the laptop is **Windows**, run the backend under **WSL2** (Ubuntu) for
     the smoothest PyTorch/CUDA setup.
2. **Python env:** `python3 -m venv backend/.venv && source
   backend/.venv/bin/activate`. Install matching `torch`/`torchvision` for your
   CUDA, then the engine's requirements. Keep these in `backend/requirements-mesh.txt`
   (separate from the MediaPipe `backend/requirements.txt`).
3. **Engine:** clone the chosen engine repo, install its deps, let weights
   download on first run. Start with **TripoSR** to prove the pipeline, then add
   **SF3D**, then **Hunyuan3D 2.1**.
4. **Node deps:** `npm install` (Fastify/multipart/better-sqlite3 already used).
5. **Run:** add an npm script (below) and start the gateway.
6. **Tailscale:** `tailscale up` on the laptop. Either bind the server to the
   tailnet IP, or bind `0.0.0.0` and restrict with **tailnet ACLs**. **Do not
   port-forward to the public internet.** From the app call
   `http://<laptop-magicdns-name>:<port>`.

### npm scripts to add (`package.json`)

```jsonc
"mesh:setup": "bash scripts/setup-mesh-backend.sh",   // venv + requirements-mesh
"mesh:api":   "node backend/server.js"                // same server, mesh routes registered
```

(If you prefer, run the mesh routes inside the existing Motion API process — they
share the Fastify app and SQLite db. A separate port via env is also fine:
reuse the `MOTION_API_PORT`/`MOTION_API_HOST` env pattern from `server.js`.)

---

## Security / exposure

- Bind to Tailscale only; never expose the raw port publicly.
- Enforce the upload size limit (the Fastify `bodyLimit` / multipart `fileSize`
  is already 512 MB — lower it for images, e.g. 25 MB).
- Validate uploaded content type is an image before queueing.
- Treat generated meshes as untrusted; don't auto-execute anything from them.

---

## Verification checklist

- `GET /api/mesh/health` reports the GPU and available engines.
- `POST /api/mesh/jobs` with a test image returns a `job_id`; status walks
  `queued → running → ready`.
- `GET /api/mesh/jobs/:id/result` returns a valid `.glb` that loads in a
  Three.js `GLTFLoader` viewer.
- Engine swap (`engine=triposr|sf3d|hunyuan3d`) works without code changes.
- Reachable from the Mac over Tailscale by MagicDNS name.
- `npm run build` stays green; `npm audit --audit-level=low` clean.
- Stale `running` jobs are recovered on restart.
- **Phase 2:** `POST /api/mesh/jobs/:id/rig` yields a `.vrm` that loads in the
  VRM editor and plays an existing `.vrma`.

---

## Bottom line

- API + Tailscale + image→mesh on a 4070: straightforward, a few days.
- Target **Hunyuan3D 2.1**; use TripoSR only as first-light.
- Biggest risk is **rig → VRM → retarget**, not generation. Ship Phase 1 first.
