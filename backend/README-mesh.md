# Mesh API (photo → 3D) — Phase 1

Adds a photo → static textured **`.glb`** service alongside the Motion API,
served from the RTX 4070 laptop over Tailscale (Phase 2 = VRM rigging, later).

Engine-agnostic by design: **TripoSR** is wired up first as an end-to-end smoke
test; SF3D and Hunyuan3D slot in behind the same `--engine` flag without code
changes.

## Layout

| File | Role |
|---|---|
| `backend/routes/mesh.js` | Fastify routes (`/api/mesh/*`), registered in `server.js` |
| `backend/lib/mesh.js` | job lifecycle, spawn worker, paths/status |
| `backend/worker/generate_mesh.py` | image → `.glb`, engine adapters |
| `backend/lib/paths.js` | `MESH_ROOT`, `meshJobDir()`, `meshResultPath()`, … |
| `backend/db/schema.sql` | `mesh_jobs` table |
| `backend/requirements-mesh.txt` | pure-Python engine deps |
| `scripts/setup-mesh-backend.sh` | venv + torch + TripoSR clone |
| `src/meshClient.js` | browser client (submit → poll → load GLB) |

Engine repos clone into `backend/engines/<Engine>/` and are added to
`sys.path` by the worker (they aren't pip packages).

## Install (WSL2 Ubuntu, RTX 4070)

The whole backend runs inside WSL2 so `spawn('.venv/bin/python3')` resolves.

```bash
# 1. System prerequisites (changes system packages — run once):
sudo apt update && sudo apt install -y build-essential git curl python3-dev

# 2. Node 20 (for the Fastify gateway), if not present:
#    e.g. via nodesource or nvm — `node -v` should be >= 18.

# 3. Mesh Python env: venv (Python 3.11 via uv) + torch (cu121) + TripoSR.
#    Downloads several GB.
npm run mesh:setup
# Tunables: TORCH_INDEX_URL (default cu121), PYTHON_VERSION (default 3.11)

# 4. Node deps:
npm install
```

Weights (`stabilityai/TripoSR`, ~1.6 GB) download automatically on the **first**
generation run into `~/.cache/huggingface`.

## Run + verify (local only, 127.0.0.1)

```bash
npm run mesh:api                                   # binds 127.0.0.1:5190
curl 127.0.0.1:5190/api/mesh/health                # { ok, gpu, engines:[triposr] }

# Submit an image, poll, download the GLB:
JOB=$(curl -s -F image=@test.png 127.0.0.1:5190/api/mesh/jobs | jq -r .job_id)
curl -s 127.0.0.1:5190/api/mesh/jobs/$JOB          # status: queued→running→ready
curl -s 127.0.0.1:5190/api/mesh/jobs/$JOB/result -o result.glb
```

`POST /api/mesh/jobs` accepts multipart `image` (PNG/JPEG/WebP, ≤25 MB) plus
optional fields `engine` (default `triposr`), `remove_bg` (default true),
`texture` (default true).

## Exposure

Bound to `127.0.0.1` only. Do **not** port-forward publicly — once it runs
locally, expose over Tailscale (bind the tailnet IP or restrict with tailnet
ACLs), then call `http://<laptop-magicdns>:5190` from the app.
