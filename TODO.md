# TODO

## ⚠️ Finish 3D Character orientation calibration (UNFINISHED)

The `3D Character` avatar (`src/glbAvatar.js`) retargets MediaPipe pose to a
Mixamo-rigged GLB. The retargeting **engine is correct** (each bone's actual
direction matches its target), but the **orientation mapping is not finalized**.

### Current state
`CAL` defaults in `src/glbAvatar.js` are `{ sx: -1, sy: -1, sz: -0.4, swapLR: false }`.
This is the state the user reported as **"arms opposite"** (limbs crossed to the
wrong side). It needs to be resolved before the character looks right.

History of attempts:
- `swapLR:false` + mirror X  → arms appear swapped/crossed ("left arm in right arm's place")
- swapping L/R bones + mirror X → user reported it looked "vertical flipped"

So both axes still need to be pinned down empirically.

### Decision needed from user
- **Mirror** (you move, character mirrors you — natural for webcam), OR
- **Direct copy** (character matches the source video frame exactly).

### How to calibrate (harness is already in place)
1. `npm run dev -- --port 5173`, open http://127.0.0.1:5173/
2. Switch avatar to **3D Character**.
3. Load the test clip via the dev hook (deterministic, repeatable):
   `window.__loadVideoURL('/sample.mp4')` then `window.__playVideo()`
   (or pause + `window.__video.currentTime = 16` + `window.__processFrame()`
   for the asymmetric reference frame: right hand up-left, left hand down).
4. Live-tune without rebuilding: `window.__avatar.cal = { sx:-1, sy:-1, sz:-0.4, swapLR:false }`
   - `sx` flips horizontal, `sy` flips vertical, `swapLR` drives each bone from the
     opposite-side landmarks.
   - Try the 4 combos of `sx` sign × `swapLR` until the character matches the dancer.
5. Bake the winning values into the `CAL` constant and remove the dev `window.__*`
   hooks in `src/app.js` if no longer needed.

### Notes
- `public/sample.mp4` is a Pexels dance clip used only for calibration (gitignored).
- Depth (`sz`) is intentionally small — MediaPipe z is noisy.
- Per-bone visibility gating relaxes a bone to rest when its landmarks aren't visible.
