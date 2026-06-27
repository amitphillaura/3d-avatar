# Handoff — Photo → 3D (client side)

**Status: client built, committed, and deployed for Tailscale testing. NOT merged to
`main`. Repo decoupling is planned but NOT executed (needs your go-ahead).**

Branch: `claude/objective-matsumoto-e47b77` · commit `3bec2ac` (client-only).

---

## ✅ Test it now (over Tailscale, from any tailnet device)

Deployed on this Mac mini (`amits-mac-mini`), served on **:5181**, bound to `0.0.0.0`:

- **http://amits-mac-mini.tail07c943.ts.net:5181/#mesh**  ← use the FULL MagicDNS name
- or **http://100.83.31.91… no →  http://100.92.73.74:5181/#mesh**  (this Mac's tailnet IP)
- ⚠️ The bare short name `http://amits-mac-mini:5181` returns **403** — Vite's
  `allowedHosts` only allows `*.ts.net`. Use the full MagicDNS name or the IP.

Drop a photo (single subject, plain background) → Generate 3D → ~50–66 s → upright,
vertex-colored GLB in the viewer + Download. Re-submitting the same image dedups
(instant). Webcam tools won't work over plain-HTTP Tailscale (need HTTPS/localhost),
but Photo → 3D uses file upload, so it's fine.

### Operate the test server
- Preview (`:5181`) log: `…/scratchpad/preview5181.log`; stop: `lsof -ti tcp:5181 | xargs kill`.
- Mesh-enabled local backend on `:5190` (proxy target) is running from this worktree.
- This is a **manual** server (survives until reboot/kill). It does **not** touch the
  other agent's launchd prod on `:5180`. For a durable deploy, merge to `main` later
  and let the existing autostart serve it.

---

## What was built (3d-avatar = CLIENT only)

| File | Role |
|---|---|
| `backend/routes/mesh.js` | **Proxy** `/api/mesh/*` → remote service (MagicDNS `amitlaptop:5190`, IP fallback). Offline→503, adds `Content-Length`, caches GLBs to `data/mesh/`. Keeps the browser same-origin. |
| `src/mesh.js` | Controller: upload/drop → submit → poll (live progress) → preview → download; graceful degradation + offline handling. |
| `src/meshViewer.js` | Clean, reusable GLB viewer (auto-frames; enables vertex colors for materialless TripoSR meshes). |
| `src/mesh.css`, `index.html`, `src/router.js` | "Photo → 3D" home card + `#mesh` view + wiring. |

No engine/server/Python code — this repo stays a pure consumer of the remote API.

Config: proxy target overridable via `MESH_REMOTE_BASE` / `MESH_REMOTE_FALLBACK` env.

---

## ⚠️ The repo-decoupling situation (READ THIS)

The **builder agent accidentally pushed the mesh SERVER into the 3d-avatar repo** as
branch `claude/triposr-mesh-api-pzhfpt` (origin). That server was supposed to be its
own project (`Phlix-Img2Model`, which is where it actually runs on the Windows box —
the canonical copy). That branch contains the TripoSR engine, queue/db, deploy
scripts, blog posts, AND its own `backend/routes/mesh.js` (the real server) +
`src/meshClient.js`.

**Collision:** both that branch and mine define `backend/routes/mesh.js` — theirs is
the *server*, mine is the *client proxy*. They must NOT be merged together.

### Decoupling plan (NOT yet done — confirm before executing)
1. **3d-avatar = client.** Keep this branch (my proxy + UI). Do not merge the builder
   branch into `main`.
2. **Mesh server → its own repo.** The authoritative copy already lives on the Windows
   box at `/mnt/c/Users/amits/projects/Phlix-Img2Model/`. Best done BY the builder
   agent / on the Windows box: `git init` there (if not already), push to a NEW GitHub
   repo (e.g. `phlix-mesh-api`). Do not snapshot from the stray 3d-avatar branch — that
   would fork a third copy.
3. **Clean up the stray branch** `claude/triposr-mesh-api-pzhfpt` from the 3d-avatar
   remote once its content is safe in the new repo. (Irreversible-ish — your call.)

### Deliberately NOT done unattended (need your go-ahead)
- Creating/pushing the new GitHub repo for the server.
- Deleting the stray `claude/triposr-mesh-api-pzhfpt` branch.
- Merging this client branch to `main` (also blocked right now: `main`'s working tree
  has the other agent's uncommitted **VRM Local Models** WIP).

---

## Server status (builder branch — FYI, already done by the builder)

The remote mesh API is v2 and shipped nearly the whole tightening wishlist: numeric
`progress`, full self-describing `result{vertices,triangles,bytes,…}`, honest
`params_applied` (texture:true → vertex colors), `timing`, `result_url`/`thumbnail_url`/
`input_url` (no path leaks), `ETag`/`Content-Length`, dedup, single-GPU queue +
`queue_position`/ETA, and **canonical orientation** (Y-up/+Z — fixed live tonight, no
client rotation needed). My client already consumes all of it.

---

## Open follow-ups (next session)
- Confirm + execute the decoupling steps above.
- When `main` is clean: merge this client branch, re-enable autostart for a durable
  `:5180` deploy (kill the manual `:5181`).
- Phase 2 bridge: server reserves `/jobs/:id/rig` + `/vrm` (501 today). Once rigging
  lands, add a "send to VRM Editor" handoff so a generated mesh becomes drivable.
- Nice-to-haves: job-history strip using `thumbnail_url`; busy/queue indicator on the
  home card using `/health`.
