# Body models (Meshy exports go here)

**Folder:** `public/models/body/`

Drop any number of rigged **GLB** files here. Each `.glb` is picked up automatically — no fixed slot limit.

1. Export from Meshy: **Animation → All Added → Single File** as **GLB**.
2. Save with any filename (e.g. `violet-vanguard.glb`, `meshy-03.glb`).
3. In the app, click **Refresh Models** (sidebar) or reload.

Optional: customize display name, rig type, or default animation in `../registry.json` under `bodyOverrides`, keyed by filename:

```json
"bodyOverrides": {
  "my-character.glb": {
    "name": "My Character",
    "rig": "meshy",
    "defaultAnimation": "Armature|walking_man|baselayer"
  }
}
```

Use `rig: "meshy"` for Meshy bipeds (`LeftArm`, `Hips`, …). Use `rig: "mixamo"` only if the skeleton uses Mixamo names.
