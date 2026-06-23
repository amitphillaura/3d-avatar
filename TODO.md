# TODO

## ✅ Done

- 3D Character orientation calibration (`CAL`: `sx: 1, sy: -1, sz: -0.4, swapLR: false`)
- Body model gallery + `public/models/registry.json` + gitignored `body/` / `face/` drop folders
- Local-only production (`npm run start` on :5180); GitHub is code + CI only
- Opt-in camera start (no automatic permission request on page load)
- Media picker supports still images (`image/*`) plus videos (`video/*`)
- Four-column 3440×1440 analysis grid with equal Raw/Head/Body/Hands player tiles,
  in-column tables, in-column model cards, Start/Stop Camera, and video loop toggle

## Open (next UX / media)

- **Visual target pass** — user supplied `/Users/amit/Downloads/504C8BFC-24F6-4935-B95B-32928B2D465D.PNG`
  as desired UI reference, but the current agent could not inspect images. Next image-capable
  agent should compare against that screenshot and refine the grid.
- **Play video / Photos library** — broaden real-file compatibility testing across user camera exports.
- **Face retargeting** — face row currently static GLB preview only.

## Open (models)

- **Meshy bone mapping** — confirm Meshy rig bone names; extend `glbAvatar.js` if not Mixamo.
- **Face model slot** — wire face landmarks to a head rig when exports are ready.
