# Mesh API — Handoff

**Status: Phase 1 complete, v2 shipped, running, and verified end-to-end over Tailscale (Mac mini → RTX 4070).** Phase 2 (VRM rigging) not started.

Branch: `claude/triposr-mesh-api-pzhfpt` · everything committed + pushed.

---

## What it is

Photo → static textured **`.glb`** service. TripoSR engine, running as a systemd
service inside WSL2 on the RTX 4070 laptop, reachable from the tailnet. Engine-
agnostic (SF3D / Hunyuan3D drop in behind the same `engine` flag later).

## Where it runs / how to reach it

| | |
|---|---|
| Host | this Windows 11 laptop → **WSL2 Ubuntu** |
| Service | systemd `mesh-api.service`, bound to **`100.83.31.91:5190`** (Tailscale IP only) |
| From the Mac / tailnet | `http://amitlaptop:5190` or `http://100.83.31.91:5190` |
| Exposure | tailnet-only — **not** on LAN/Wi-Fi, **not** public |
| Boot | auto-starts at Windows logon (Startup VBS → WSL → systemd, kept alive) |

## Operate it

```bash
wsl -d Ubuntu -u root -- systemctl status  mesh-api
wsl -d Ubuntu -u root -- systemctl restart mesh-api
wsl -d Ubuntu -u root -- journalctl -u mesh-api -f
```
- Health from **Mac**: `curl http://amitlaptop:5190/api/mesh/health`
- Health from **Windows host**: `curl.exe http://100.83.31.91:5190/api/mesh/health`
- ⚠️ **Do not test from *inside* WSL** — the Hyper-V firewall rule is scoped to the
  tailnet, so WSL-internal curls to the Tailscale IP are blocked. Test from the Mac
  or the Windows host.

## API (submit → poll → download)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/mesh/health` | `{ok, gpu, engines, busy, queue_depth, phase, rig_available, max_image_bytes}` |
| POST | `/api/mesh/jobs` | multipart `image` + fields `engine, remove_bg, texture, normalize` → `201 {job_id, status, deduped}` |
| GET | `/api/mesh/jobs` / `/:id` | full job: `progress`, `result{…}`, `params_requested/applied`, `timing`, `error{code,message,stage}`, `*_url`, `queue{position,eta_ms}` |
| GET | `/api/mesh/jobs/:id/result` | `model/gltf-binary`, `Content-Length`, `ETag` (sha256), `If-None-Match → 304` |
| GET | `/api/mesh/jobs/:id/thumbnail` | preview PNG |
| GET | `/api/mesh/jobs/:id/input` | bg-removed input PNG |
| DELETE | `/api/mesh/jobs/:id` | (refuses while running/queued) |
| POST/GET | `/api/mesh/jobs/:id/rig` · `/vrm` | **501** — Phase 2 reserved |

Meshes are **canonical**: centered, unit-scaled, `up_axis:"Y"`, `front_axis:"+Z"`
(load with a default Three.js camera, no client-side rotation needed). Dedup is by
`sha256(image + params)`. One GPU → jobs serialize; generation ≈ 50–66 s/image.

## Code map (all committed)

- `backend/routes/mesh.js`, `backend/lib/mesh.js`, `backend/lib/paths.js`
- `backend/worker/generate_mesh.py` + `backend/engines/torchmcubes_shim.py` (PyMCubes CPU shim)
- `backend/db/schema.sql` (`mesh_jobs` + `ensureMeshColumns` migration), `backend/requirements-mesh.txt`
- `scripts/setup-mesh-backend.sh`, `scripts/install-mesh-service.{sh,ps1}`, `backend/deploy/mesh-api.service`
- `src/meshClient.js`, `backend/README-mesh.md`
- `docs/blog-photo-to-3d-mesh-api.{html,md}`, `docs/blog-wsl2-tailscale-exposure.html`

## Machine-local config (NOT in git — host-specific; recreate if you rebuild the box)

- **`~/.wslconfig`**: `[wsl2] networkingMode=mirrored`, `vmIdleTimeout=-1`; `[experimental] hostAddressLoopback=true`
- **systemd drop-in** `/etc/systemd/system/mesh-api.service.d/override.conf`: `Environment=MOTION_API_HOST=100.83.31.91`, `StartLimitIntervalSec=0`, `Restart=on-failure`
- **Windows Firewall** rule "Mesh API (Tailscale 5190)": inbound TCP 5190 from `100.64.0.0/10`
- **Hyper-V firewall** rule "Mesh API (Tailscale 5190)": inbound TCP 5190 from `100.64.0.0/10` ← *this* is the one that actually admits external tailnet peers in mirrored mode
- **Startup launcher**: `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\PhlixMeshApi.vbs` (boots WSL + `sleep infinity` keep-alive)
- **Gitignored runtime**: `backend/.venv` (Python 3.11 via uv), `backend/engines/TripoSR` clone, weights in `~/.cache/huggingface`, `data/mesh/<jobId>/`

## Known-good versions (pin these)

Windows 11 24H2 · WSL2 2.6.3 · Ubuntu 26.04 · Tailscale 1.98.4 · Python 3.11.15 (uv) · Node 22.23.1
torch **2.5.1+cu121** · **transformers 4.35.0** (5.x breaks the TripoSR ViT checkpoint — keep pinned) · tokenizers 0.14.1 · huggingface-hub 0.17.3 · PyMCubes 0.1.6 · onnxruntime 1.27.0 · trimesh 4.0.5 · numpy 1.26.4

## Gotchas

- **transformers MUST stay 4.35.0**; `requirements-mesh.txt` must NOT re-pin engine deps (it silently upgrades transformers).
- `torchmcubes` won't build here (needs nvcc; Caffe2 hard-requires CUDA) → we use the **PyMCubes CPU shim**.
- WSL-internal curl to the Tailscale IP is blocked (tailnet-scoped Hyper-V rule) — test from Mac/host.
- **Always-on = while logged in.** Survive logout/login-screen needs a Windows *Service* wrapper (TODO).
- Driving WSL via PowerShell: avoid inline `$(...)`/pipes/nested quotes — write a script file and run it.

## Next up (the "tighten the service" pass)

- Finer progress granularity during inference (currently sits at 50 for the forward pass).
- Job timeout + concurrency guard; disk cleanup of old `data/mesh/<id>`.
- **True always-on** via a Windows Service wrapper (NSSM or Task Scheduler "run whether logged on or not").
- **Phase 2 — rig → VRM**: auto-rig (UniRig / Mixamo) + Blender headless VRM convert/retarget. The hard ~70%. `vrm_path` column + `/rig`,`/vrm` endpoints are reserved (501); `/health.rig_available` flips to `true` when it lands.

## Git

- Branch `claude/triposr-mesh-api-pzhfpt`, HEAD `443b6cf`, pushed to origin.
- 6 commits: build spec → Phase 1 API → Tailscale blog → firewall correction → v2 API → orientation fix.
- See "Merge status" note at the bottom for main.
