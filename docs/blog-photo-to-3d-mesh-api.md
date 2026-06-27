# From Photo to 3D Mesh on a Laptop GPU: Building Phase 1 of a Home Mesh API

*How we stood up a photo → textured `.glb` service on an RTX 4070 laptop, ran it
under WSL2, made it start on boot — and fought four dependency battles to get
TripoSR generating meshes through an HTTP API.*

**Stack:** TripoSR · PyTorch (CUDA 12.1) · Python 3.11 (via uv) · WSL2 Ubuntu ·
Fastify + SQLite · NVIDIA RTX 4070 Laptop (8 GB) · Windows 11.

> 🤖 **Designed, built, debugged & written by Claude** — Anthropic Opus 4.8
> (`claude-opus-4-8`), end-to-end from the first `nvidia-smi` to a running
> service. · **June 26, 2026**

---

## TL;DR

- **Goal:** single photo → static textured **`.glb`**, served from a home RTX 4070
  laptop over a submit/poll/download HTTP API, auto-starting on boot, local-only.
- **Engine:** **TripoSR** as a smoke test (engine-agnostic design; SF3D / Hunyuan3D
  drop in behind the same flag later).
- **Runtime:** the whole backend (Node + Python) runs in **WSL2 Ubuntu**; GPU via
  WSL CUDA passthrough.
- **The hard part wasn't the code — it was the dependencies:** `torchmcubes`
  needs `nvcc` (we don't have it) → CMake `find_package(Torch)` hard-requires CUDA
  → **replaced with a compile-free PyMCubes CPU shim**; plus a `transformers`
  major-version bump that broke checkpoint loading.
- **Result:** photo → `.glb` (42 076 verts, watertight, **~54 s** on `cuda:0`),
  end to end through the API, as a systemd service that survives reboots.

---

## Environment (reproducible)

Everything below is the exact box this was built and verified on. If yours is
close, the same recipe should work.

### Hardware

| Component | Spec |
|---|---|
| Laptop GPU | **NVIDIA GeForce RTX 4070 Laptop GPU**, **8 GB GDDR6** (8188 MiB) |
| CPU | Intel Core **i9-14900HX** |
| iGPU | Intel UHD Graphics (unused for compute) |

> The 8 GB VRAM matters: TripoSR needs ~4 GB and is happy here. SF3D (~6–7 GB) fits;
> Hunyuan3D 2.1 (~8–12 GB) is borderline; TRELLIS (~16 GB) won't fit on a laptop 4070.

### OS / platform

| Layer | Version |
|---|---|
| Windows | **Windows 11 Pro 24H2** (build 26200) |
| NVIDIA driver (Windows) | **591.74** |
| Max CUDA supported by driver | **13.1** |
| WSL | **2.6.3.0** (kernel 6.6.87.2-1, WSLg 1.0.71) |
| WSL distro | **Ubuntu 26.04 LTS** (systemd as PID 1) |
| GPU in WSL | `nvidia-smi` sees the 4070 via CUDA passthrough |

### Toolchain (installed)

| Tool | Version | Notes |
|---|---|---|
| Python | **3.11.15** | via **`uv`** — the distro's default 3.14 is too new for ML wheels |
| Node.js | **22.23.1** | in WSL (NodeSource); runs the Fastify gateway |
| gcc / build-essential | 15.2.0 | for native node modules |
| CUDA toolkit (`nvcc`) | **not installed** | torch's cu121 wheels bundle the CUDA *runtime*; no toolkit needed (this is central to the `torchmcubes` story below) |

### Known-good Python package versions

These are the versions that actually load TripoSR's checkpoint and run. **Pin
them** — newer is not better here (see the `transformers` battle).

| Package | Version | Why pinned |
|---|---|---|
| `torch` / `torchvision` | **2.5.1+cu121** | CUDA 12.1 wheels; backward-compatible with the 13.1 driver |
| `transformers` | **4.35.0** | 5.x refactored `ViTModel`'s state dict → checkpoint won't load |
| `tokenizers` | 0.14.1 | matches transformers 4.35 |
| `huggingface-hub` | 0.17.3 | matches transformers 4.35 |
| `PyMCubes` | 0.1.6 | CPU marching-cubes backend for the `torchmcubes` shim |
| `onnxruntime` | 1.27.0 | `rembg` backend (it's now an optional extra) |
| `rembg` | 2.0.69 | background removal |
| `trimesh` | 4.0.5 | `.glb` export |
| `numpy` | 1.26.4 | `<2` required by numba/llvmlite in the stack |
| `omegaconf` / `einops` / `Pillow` | 2.3.0 / 0.7.0 / 10.1.0 | TripoSR pins |

Model weights download on first run: **`stabilityai/TripoSR`** (~1.6 GB) and
rembg's **`u2net.onnx`** (~176 MB), cached afterward.

---

## The goal

We wanted a small service that turns a single photo into a 3D model, running on a
home machine (Lenovo laptop, **RTX 4070 Laptop GPU, 8 GB**) and callable from our
app over Tailscale. It slots into an existing repo whose backend is **Fastify +
better-sqlite3 + Python workers** — a Motion API that extracts pose landmarks from
video. The mesh service should feel like a sibling of that, not a bolt-on.

The work splits into two phases:

- **Phase 1 — image → static textured mesh (`.glb`).** Self-contained and useful
  immediately: preview generated meshes in a Three.js viewer.
- **Phase 2 — mesh → animatable `.vrm`** (auto-rig + VRM convert/retarget). The
  hard, unreliable part. Explicitly out of scope here.

This post is the story of shipping **Phase 1**. The code came together quickly;
the *environment* is where the interesting fights were.

---

## Design decisions (before any code)

A few choices shaped everything:

1. **Engine-agnostic from day one.** The branch was named after TripoSR, but the
   4070 can run better engines (SF3D, Hunyuan3D). So the API dispatches on an
   `engine` flag and each model lives behind an isolated adapter. TripoSR is the
   *smoke-test* engine — fastest to first light — not the destination.
2. **A job queue, not a synchronous request.** Generation takes tens of seconds.
   The contract is **submit → poll → download**: `POST /api/mesh/jobs` returns a
   job id, `GET /api/mesh/jobs/:id` reports `queued → running → ready|failed`, and
   `GET /api/mesh/jobs/:id/result` streams the `.glb`.
3. **Mirror the existing backend exactly.** A new route module, a `mesh_jobs`
   table, and a Python worker spawned via `spawn(PYTHON_BIN, …)` — the same shape
   as the Motion API's `processor.js` / `process_video.py`, down to the stdout
   protocol (`PROGRESS:<n>` lines + a final JSON status line).
4. **WSL2, with the whole backend inside it.** On Windows, the smoothest
   PyTorch/CUDA path is WSL2 Ubuntu. Crucially, *Node runs in WSL too* — otherwise
   `spawn('.venv/bin/python3')` (a POSIX path) wouldn't resolve.
5. **Local only.** Bind `127.0.0.1`, enforce a 25 MB image limit, validate content
   types. Tailscale comes later; nothing is exposed publicly.

The data model is one table:

```sql
CREATE TABLE mesh_jobs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'queued',   -- queued|running|ready|failed
  stage  TEXT NOT NULL DEFAULT 'mesh',     -- mesh|rig
  engine TEXT NOT NULL,                     -- triposr|sf3d|hunyuan3d
  source_path TEXT NOT NULL,
  result_path TEXT, vrm_path TEXT,
  error TEXT, params_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

---

## The build

The Node side went in cleanly because it copied conventions that already existed:

- `backend/lib/paths.js` — `MESH_ROOT`, `meshJobDir()`, `meshResultPath()`, …
- `backend/lib/mesh.js` — job lifecycle, `spawn` the worker, parse its protocol,
  walk job status, and `recoverStaleMeshJobs()` on startup (any `running` row left
  by a crash → `failed`).
- `backend/routes/mesh.js` — the `/api/mesh/*` endpoints, multipart upload with a
  per-route 25 MB cap, content-type validation, engine gating.
- `backend/worker/generate_mesh.py` — engine dispatch. Each adapter imports its
  heavy deps *inside* the function so a missing engine never breaks the others.

The TripoSR adapter is the only one wired up; SF3D/Hunyuan3D return a clean
"not installed yet" so the contract is stable but honest.

**We validated the whole Node layer before touching Python.** On the Windows host
(Node 22 already present), booting the server and curling the endpoints proved the
schema, routes, validation (`201 / 409 / 415`), the job lifecycle, and `DELETE`
— all without a single GB downloaded. The worker spawn failed gracefully with
"Python not found" (the expected Windows fallback), confirming the error path.
That's the cheap confidence you want before committing to multi-GB installs.

---

## The environment odyssey

Here's where a "few-days" task earns its war stories. Every one of these was a
*real* failure with a fix, not a hypothetical.

### 0. Ubuntu 26.04 ships Python 3.14 — too new for ML

A fresh WSL2 Ubuntu 26.04 had **Python 3.14**, no Node, no build tools. PyTorch
has no 3.14 wheels. Rather than wrangle a PPA, we used **`uv`** to manage a
**Python 3.11** toolchain and venv — no system Python touched. (`uv venv` still
produces the `.venv/bin/python3` layout the backend expects.) torch went in from
the **cu121** wheels — newer than the box's CUDA 13.1 driver, which is fine
because drivers are backward compatible.

GPU passthrough worked out of the box: `nvidia-smi` saw the 4070 inside WSL, and
`torch.cuda.is_available()` returned `True`.

### 1. `torchmcubes` wants `nvcc` (and an atomic installer hides it)

TripoSR's only compiled dependency is `torchmcubes` (marching cubes). Its build
checks `torch.cuda.is_available()` — which is `True` in WSL — and tries to compile
a **CUDA** extension. But WSL has no `nvcc`. The build failed, and because
`uv pip install -r` is **atomic**, that single failure rolled back the *entire*
requirements file (even pure-Python packages like `omegaconf` were absent — a
confusing symptom until you realize it's all-or-nothing).

First fix attempt: build with the GPU hidden so it picks the CPU path:
`CUDA_VISIBLE_DEVICES="" pip install …`. Progress — CMake now logged *"NO CUDA
INSTALLATION FOUND, TRYING TO INSTALL CPU VERSION ONLY!"*

### 2. …but `find_package(Torch)` drags in a hard CUDA requirement

The newer `torchmcubes` uses CMake/scikit-build-core, which does
`find_package(Torch)`. Two new problems:

- **Build isolation** gave the build a throwaway env with *no torch* — it couldn't
  find `TorchConfig.cmake` (or would try to re-download torch, ~2.5 GB).
- Fixing that with `--no-build-isolation` + `CMAKE_PREFIX_PATH` pointed at the
  venv's torch got CMake to *find* Torch — and then **Caffe2's CMake config hard-
  required CUDA libraries** at configure time, *because our torch is the cu121
  build*. Even for a CPU-only extension. No CUDA toolkit → dead end.

The honest options were: install a ~3 GB CUDA toolkit just for marching cubes, or
stop fighting.

### 3. The fix: a compile-free CPU shim

TripoSR only needs `marching_cubes(level, 0.0) → (verts, faces)`. So we replaced
`torchmcubes` with a tiny **drop-in shim backed by PyMCubes** (which ships
manylinux wheels — *no compiler*). It installs into the venv *as* `torchmcubes`,
so TripoSR's `from torchmcubes import marching_cubes` resolves to it and the engine
source stays untouched:

```python
# backend/engines/torchmcubes_shim.py
import mcubes, numpy as np, torch

def marching_cubes(vol, isovalue=0.0):
    arr = vol.detach().cpu().numpy().astype(np.float64)
    verts, faces = mcubes.marching_cubes(arr, float(isovalue))
    verts = verts[:, [2, 1, 0]]          # PyMCubes (i,j,k) -> torchmcubes (k,j,i)
    return (torch.from_numpy(np.ascontiguousarray(verts)).float(),
            torch.from_numpy(np.ascontiguousarray(faces)).long())
```

The `[2, 1, 0]` swap matters: PyMCubes returns vertices in array-index order
`(i,j,k)`; the real torchmcubes returns `(k,j,i)`; and TripoSR applies its own
`[2,1,0]` downstream. Match the convention here and the geometry comes out correct
— which the smoke test confirmed (a **watertight** mesh with sensible bounds), not
mirrored.

### 4. The `transformers` trap (loose pins bite at load time)

Our `requirements-mesh.txt` had loose pins (`transformers>=4.35`) "for clarity."
Installed *after* TripoSR's pinned `transformers==4.35.0`, they silently upgraded
it to **5.12.1**. Imports still worked — `ViTModel` imported fine — so it *looked*
healthy. Then the model weights failed to load:

```
Missing key(s):    image_tokenizer.model.layers.0.attention.q_proj.weight …
Unexpected key(s): image_tokenizer.model.encoder.layer.0.attention.attention.query.weight …
```

transformers 5.x **refactored `ViTModel`'s state-dict layout**, so TripoSR's
checkpoint (saved against 4.x naming) couldn't load. Fix: pin back to **4.35.0**
(with matching `tokenizers==0.14.1`, `huggingface-hub==0.17.3`).

> **Lesson:** never re-pin packages an engine already pins. We rewrote
> `requirements-mesh.txt` to own *only* what the engine doesn't (e.g.
> `onnxruntime`, `PyMCubes`) and to explicitly *not* list `transformers`,
> `huggingface-hub`, etc.

### 5. One more: `rembg` made `onnxruntime` optional

Background removal failed with `No module named 'onnxruntime'`. Recent `rembg`
moved `onnxruntime` to an optional extra, so `rembg` alone doesn't pull it. We add
`onnxruntime` explicitly (CPU is plenty fast for single-image masking).

---

## Making it a service that starts on boot

Running the backend in WSL2 complicates "start on boot," because **WSL only boots
on demand** — an enabled service won't run until *something* starts the distro.
The clean answer is two small pieces:

1. **A systemd unit inside WSL** (`backend/deploy/mesh-api.service`) with
   `Restart=on-failure`, binding `127.0.0.1:5190`, installed and `enable`d. (WSL2
   here already runs systemd as PID 1.) This is the real service.
2. **A Windows logon launcher** — a hidden VBS in the user's Startup folder that
   runs `wsl -d Ubuntu -u root -- systemctl start mesh-api` at sign-in. It boots
   WSL, systemd brings up the enabled service, and it's a no-op if already running.
   **No admin required** (we tried a Scheduled Task first; registering one needs
   elevation, the Startup folder doesn't).

One ordering subtlety bit us conceptually: `mesh.js` resolves `PYTHON_BIN`
(`.venv/bin/python3` vs fallback) **once at startup**. Start the service *before*
the venv exists and it caches the wrong interpreter. So: finish the install, then
start the service. We validated the smoke test *through the running service* to
prove both at once.

---

## Results

End to end, through the HTTP API, on the 4070:

```
GET  /api/mesh/health  -> { gpu: "NVIDIA GeForce RTX 4070 Laptop GPU, 8188 MiB",
                            engines: ["triposr"] }
POST /api/mesh/jobs    -> 201 { job_id, status: "queued" }
       status walk      -> queued -> running -> ready   (~66 s incl. masking)
GET  /…/result          -> 200 model/gltf-binary, 1.68 MB
```

The mesh: **42 076 vertices / 84 156 faces**, vertex-colored, **watertight**.
Worker-reported inference time **~54 s** (`device=cuda:0`, `cuda_available=true`).
First run also downloads weights (`stabilityai/TripoSR`, ~1.6 GB) and the rembg
`u2net.onnx` (~176 MB), both cached afterward.

A note on storage: we kept the repo (and `.venv`) on the Windows filesystem at
`/mnt/c`. It works, but `uv` can't hardlink across filesystems, so installing
~3 GB of torch is a slow full copy. If that bites, moving `.venv` onto WSL's native
ext4 is the fix.

---

## What Phase 1 buys, and what's next

Phase 1 is shippable on its own: any photo → a static textured `.glb` you can load
in a Three.js `GLTFLoader`, served from a home GPU over a job-queue API that starts
on boot and stays local until we bind it to Tailscale.

The honest caveat for the end goal: every image-to-3D engine emits a *static,
unrigged* mesh in the photo's pose. None produce a VRM humanoid. The mesh step is
~30% of the work; **rig → VRM → retarget is the other ~70%** — that's Phase 2, and
it's where the real risk lives.

**Takeaways for anyone doing this on a Windows + WSL2 + laptop-GPU box:**

- Use `uv` to pin an older Python when the distro ships a too-new one.
- Validate the non-GPU layers cheaply before downloading gigabytes.
- A research repo's compiled dep (`torchmcubes`) is often the whole fight — a
  compile-free CPU shim can be worth more than a 3 GB toolkit.
- Don't re-pin an engine's transitive deps; loose ranges upgrade them and the
  break can hide until weight-load time.
- For "starts on boot" under WSL2: systemd service *inside* + a no-admin logon
  launcher *outside*.

---

## Errors you might hit (and the fix)

Searchable, because these cost us hours:

| Error (abridged) | Cause | Fix |
|---|---|---|
| `Could not find ... TorchConfig.cmake` while building torchmcubes | build isolation hides the venv's torch | `--no-build-isolation` + `CMAKE_PREFIX_PATH=$(python -c 'import torch;print(torch.utils.cmake_prefix_path)')` |
| `Caffe2: CUDA cannot be found` / `Your installed Caffe2 version uses CUDA but I cannot find the CUDA libraries` | torch is the CUDA build, so `find_package(Torch)` hard-requires a CUDA toolkit | don't build torchmcubes — use a PyMCubes CPU shim |
| `Could NOT find CUDA (missing: CUDA_NVCC_EXECUTABLE)` | no `nvcc` in WSL | same — avoid the native build, or install a CUDA toolkit |
| `Missing key(s) ... layers.0.attention.q_proj` / `Unexpected key(s) ... encoder.layer.0.attention.attention.query` | `transformers` 5.x changed `ViTModel`'s state dict | pin `transformers==4.35.0` (+ `tokenizers==0.14.1`, `huggingface-hub==0.17.3`) |
| `No module named 'onnxruntime'` (from `rembg`) | rembg made onnxruntime an optional extra | `pip install onnxruntime` |
| `ModuleNotFoundError: torchmcubes` at runtime | shim not on the path | install the shim into site-packages as `torchmcubes` |
| Slow multi-GB `pip`/`uv` installs, `Failed to hardlink files` | venv on `/mnt/c` (DrvFs) can't hardlink across filesystems | accept the copy, or put `.venv` on WSL ext4 |

---

## Keywords / tags

`image to 3D` · `photo to 3D model` · `TripoSR` · `Stable Fast 3D` · `Hunyuan3D` ·
`single image to mesh` · `image to GLB` · `text to 3D` · `PyTorch CUDA 12.1` ·
`RTX 4070 Laptop 8GB` · `WSL2 CUDA passthrough` · `Ubuntu 26.04 Python 3.11 uv` ·
`torchmcubes build error` · `torchmcubes no nvcc` · `PyMCubes marching cubes` ·
`TorchConfig.cmake not found` · `Caffe2 CUDA cannot be found` ·
`transformers ViTModel state dict mismatch` · `rembg onnxruntime` · `Fastify job queue` ·
`better-sqlite3` · `systemd service WSL2` · `start WSL service on Windows boot` ·
`Tailscale home GPU server` · `Three.js GLTFLoader` · `self-hosted 3D generation`

*Built on Windows 11 + WSL2 Ubuntu 26.04 with an NVIDIA RTX 4070 Laptop GPU.*
