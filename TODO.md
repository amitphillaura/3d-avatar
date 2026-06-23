# TODO

## ✅ Done

- 3D Character orientation calibration (`CAL`: `sx: 1, sy: -1, sz: -0.4, swapLR: false`)
- Body model gallery + `public/models/registry.json` + gitignored `body/` / `face/` drop folders
- Local-only production (`npm run start` on :5180); GitHub is code + CI only
- Opt-in camera start (no automatic permission request on page load)
- Media picker supports still images (`image/*`) plus videos (`video/*`)

## Open (next UX / media)

- **Unified media view** — continue improving camera/video/photo controls and file-state affordances.
- **Play video / Photos library** — broaden real-file compatibility testing across user camera exports.
- **Face retargeting** — face row currently static GLB preview only.

## Open (models)

- **Meshy bone mapping** — confirm Meshy rig bone names; extend `glbAvatar.js` if not Mixamo.
- **Face model slot** — wire face landmarks to a head rig when exports are ready.
