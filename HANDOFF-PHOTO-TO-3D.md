# Handoff — Photo → 3D (client side)

**Status: DONE — merged to `main`, pushed to origin, deployed on :5180.**
The mesh server is decoupled into its own repo and SF3D is live.

3d-avatar is a **pure client**: the `#mesh` view + a thin backend proxy to the
remote mesh service. No engine/server code lives here.

## What it is

`/#mesh` ("Photo → 3D") — upload a photo, get a 3D `.glb`. Two quality tiers:

- **Fast — TripoSR** (~1 min, vertex-color "clay").
- **High Quality — SF3D** (UV-textured, ~1 min). The panel is health-aware: it
  auto-enables when `/api/mesh/health.engines` includes a non-TripoSR engine.

The viewer smooths untextured TripoSR meshes (computed normals) and preserves
SF3D's baked PBR material. Meshes are canonical Y-up / +Z-front, so they render
upright and facing the camera with no client-side rotation.

## Architecture (decoupled)

```
3d-avatar client (this repo)            phlix-mesh-api (separate repo, on the GPU box)
  #mesh UI + MeshViewer                   Fastify + SQLite job queue
  backend/routes/mesh.js  ── proxy ──►    backend/worker/generate_mesh.py (TripoSR | SF3D)
  /api/mesh/* (same-origin)   Tailscale    bound to the Tailscale IP, tailnet-only
```

- **Mesh server repo:** https://github.com/amitphillaura/phlix-mesh-api (private).
  Runs on the RTX 4070 / WSL2 box, reachable at `amitlaptop:5190` over Tailscale.
- **Proxy:** `backend/routes/mesh.js` forwards `/api/mesh/*` to the remote
  (`MESH_REMOTE_BASE`, default `http://amitlaptop:5190`, IP fallback), keeps the
  browser same-origin, adds `Content-Length`, caches GLBs to `data/mesh/`.

## Key files (this repo)

| File | Role |
|------|------|
| `src/mesh.js` | Controller: upload/drop → submit → poll → preview → download; two engine modes; health-aware HQ panel |
| `src/meshViewer.js` | Reusable GLB viewer (auto-frame; smooth TripoSR, keep SF3D PBR) |
| `backend/routes/mesh.js` | Tailscale proxy to the remote mesh API |
| `src/mesh.css`, `index.html`, `src/router.js` | "Photo → 3D" home card + `#mesh` view |

## Deploy

Lives on the durable launchd prod **http://127.0.0.1:5180/#mesh** (also reachable
over Tailscale at `http://amits-mac-mini.tail07c943.ts.net:5180/#mesh` — full
MagicDNS name or IP `100.92.73.74`; the bare short name 403s via Vite allowedHosts).
`main` is pushed to origin.

## Status of the moving parts

- **SF3D** shipped by the Windows agent, verified end-to-end (UV-textured,
  upright, forward-facing). TripoSR stays the default.
- **Hunyuan3D** deferred — its textured stage needs ~21 GB, doesn't fit the 8 GB
  4070. Reserved behind the same flag for a bigger GPU.
- **Orientation:** SF3D initially came out facing −Z (backwards); fixed with a
  180° yaw in `phlix-mesh-api`'s `run_sf3d` (single rotation, verified forward).

## Remaining (optional)

- Delete the superseded branches once you're sure: `claude/sf3d-engine`
  (phlix-mesh-api, merged) and `claude/triposr-mesh-api-pzhfpt` (3d-avatar,
  replaced by phlix-mesh-api).
- Phase 2 bridge: `phlix-mesh-api` reserves `/jobs/:id/rig` + `/vrm` (501 today).
  Once auto-rig lands, add a "send to VRM Editor" handoff so a generated mesh
  becomes drivable.

## Provenance

Built overnight by two Claude agents (this Mac client + the Windows GPU engine
agent) coordinating via a shared git repo and the Tailscale health endpoint.
Write-ups in `phlix-mesh-api/docs/blog-*.html`.
