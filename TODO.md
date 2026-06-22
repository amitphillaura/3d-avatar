# TODO

## ✅ 3D Character orientation calibration (DONE)

Baked `CAL` in `src/glbAvatar.js`:

```js
{ sx: 1, sy: -1, sz: -0.4, swapLR: false }
```

`sx: 1` maps image-left to screen-left on the frontal rig viewport — the same
convention as the camera canvas and Live Keypoints skeleton preview. The previous
`sx: -1` default (and the short-lived camera “mirror” preset) put the anatomical
left arm on the right side of the viewport.

Live override: `window.__avatar.cal = { sx, sy, sz, swapLR }`.
