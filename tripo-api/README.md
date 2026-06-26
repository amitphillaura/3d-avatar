# TripoSR API (internal asset generation)

Single image → 3D mesh, fast. A thin [FastAPI](https://fastapi.tiangolo.com/)
wrapper around [TripoSR](https://github.com/VAST-AI-Research/TripoSR) that runs
on the Lenovo and is reachable across our machines over **Tailscale**.

> **Internal tool only.** This generates *raw* meshes to seed our model packs.
> It is **not** part of the storefront and isn't linked from it — cleaned-up,
> licensed assets get published separately via our own CDN. Nothing here should
> be exposed to the public internet.

## What it does

`POST /generate` with an image → returns a `.glb` (default) or `.obj` mesh.
Background removal (rembg) + foreground framing happen automatically — TripoSR
expects a single centered subject on a neutral plate.

## Setup (once, on the Lenovo)

```bash
cd tripo-api
./setup.sh            # CPU build — works anywhere, slow (~30s–2min/mesh)
./setup.sh cu121      # NVIDIA GPU, CUDA 12.1 — fast (sub-second to a few sec)
```

`setup.sh` creates `.venv`, installs the right PyTorch, clones TripoSR into
`vendor/TripoSR`, and builds its deps (incl. `torchmcubes`, which compiles
against torch — that's why torch is installed first). The venv, the cloned repo,
and the downloaded weights are all gitignored.

Pick the CUDA variant that matches your driver: `cu118`, `cu121`, or `cu124`.
Check with `nvidia-smi`; if there's no NVIDIA GPU, use the default CPU build.

## Run

```bash
./run.sh                       # binds 0.0.0.0:8000
PORT=9000 ./run.sh             # different port
TRIPO_API_KEY=secret ./run.sh  # require  X-API-Key: secret  on requests
```

The first request (or `POST /warmup`) downloads the ~1.7 GB weights from Hugging
Face and loads the model; everything after that is fast.

## Use it

```bash
# local
python client_example.py photo.png out.glb

# from another machine over the tailnet (MagicDNS name of the Lenovo)
python client_example.py photo.png out.glb \
  --url http://lenovo.your-tailnet.ts.net:8000

# raw curl
curl -X POST "http://127.0.0.1:8000/generate?format=glb" \
  -F "image=@photo.png" -o out.glb
```

## Tailscale access

The server binds `0.0.0.0`, so once both boxes are on the tailnet just hit the
Lenovo's tailnet IP or MagicDNS name on the chosen port:

```bash
tailscale up                          # on the Lenovo, if not already up
tailscale ip -4                       # its tailnet IP
# → http://100.x.y.z:8000  or  http://lenovo.<tailnet>.ts.net:8000
```

Optional HTTPS + nicer hostname without opening any firewall port:

```bash
tailscale serve --bg 8000             # proxies https://lenovo.<tailnet>.ts.net → :8000
```

Because the tailnet is private to our devices, this stays internal. Set
`TRIPO_API_KEY` for a second layer if you like, but **do not** `tailscale
funnel` this to the public internet.

## API

| Method | Path | Notes |
|--------|------|-------|
| GET  | `/health`  | status, device, whether weights are loaded |
| POST | `/warmup`  | force-load the model now (avoids a slow first request) |
| POST | `/generate` | `multipart` field `image`; query: `format=glb\|obj`, `mc_resolution=32..512`, `foreground_ratio=0..1` |

Response headers on `/generate`: `X-Generation-Seconds`, `X-Device`.

## Config (env vars)

| Var | Default | Meaning |
|-----|---------|---------|
| `TRIPO_DEVICE` | `auto` | `auto` / `cuda` / `mps` / `cpu` |
| `TRIPO_CHUNK_SIZE` | `8192` | lower → less VRAM, slower |
| `TRIPO_MC_RESOLUTION` | `256` | marching-cubes grid; higher → finer + slower |
| `TRIPO_FOREGROUND` | `0.85` | subject framing ratio |
| `TRIPO_MODEL_ID` | `stabilityai/TripoSR` | HF repo |
| `TRIPO_API_KEY` | _(off)_ | require `X-API-Key` header |
| `TRIPO_REMBG` | `1` | `0` to skip background removal |
| `TRIPOSR_PATH` | `./vendor/TripoSR` | where the cloned repo lives |

## Notes & gotchas

- **License:** TripoSR weights are released by Stability AI under their
  community/research terms — confirm the current license on the model card
  before selling anything derived from its output. This box produces raw geometry;
  treat provenance the same way we do for motion packs.
- **Quality:** single-image reconstruction is a *starting point*, not a final
  asset — expect to retopo/clean in Blender before it's pack-ready.
- **Single worker** by design: the weights are big and per-process. Scale by
  running on a GPU and raising `mc_resolution` only when you need detail.
- **Output format:** `.glb` matches our three.js pipeline; `.obj` if you want a
  plain mesh for DCC tools.
