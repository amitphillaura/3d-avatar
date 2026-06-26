# Motion Library Backend

Local API for importing videos, extracting MediaPipe landmarks, enriching them into
Skeleton 2D + Mushy 3D coordinates, tagging motion segments, and building search matrices.

## Setup (once)

```bash
npm run backend:setup
```

Creates `backend/.venv` and installs Python deps. Model files (`.task`) download
automatically on first process run into `backend/models/`.

## Run

```bash
npm run backend          # API → http://127.0.0.1:5190
npm run dev              # Pose tester + /api proxy
npm run start:full       # build + backend + prod UI on :5180
```

UI: http://127.0.0.1:5180/motion.html (or http://127.0.0.1:5173/motion.html in dev)

## Data layout

```
data/
  motion.db                 # SQLite catalog
  videos/{video_id}/
    source.mp4
    raw.jsonl               # L0 MediaPipe output
    processed.jsonl         # L0 + skeleton_2d + rig + detection flags
    matrices/{segment_id}.json
```

## Pipeline layers (per frame)

| Layer | Field | Source |
|-------|-------|--------|
| L0 | `raw` | MediaPipe Tasks (pose/face/hands) |
| L1 | `skeleton_2d` | `backend/lib/skeleton2d.js` |
| L2 | `rig` | `src/poseSkeleton.js` via `backend/lib/rig3d.js` |
| L3 | segment `matrix` | root-relative joint trajectories + search vector |

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/videos` | List videos |
| POST | `/api/videos` | Upload (`multipart`: `file`, `rig_variant`, `tracking_mode`) |
| GET | `/api/videos/:id` | Video detail + tags + segments |
| POST | `/api/videos/:id/process` | Start Holistic batch job |
| GET | `/api/videos/:id/frames?from=&to=` | Processed frame bundle |
| GET | `/api/videos/:id/frames/:index` | Single frame |
| GET | `/api/videos/:id/source` | Stream source video |
| POST | `/api/videos/:id/tags` | Add tag |
| POST | `/api/videos/:id/segments` | Create tagged segment |
| PATCH | `/api/segments/:id` | Update segment labels |
| POST | `/api/segments/:id/build-matrix` | Build motion matrix |
| GET | `/api/segments/:id/matrix` | Fetch matrix JSON |
| GET | `/api/segments/:id/export` | Export clip for rig replay |
| GET | `/api/search/motion?q=` | Word/tag search over segments |

## Segment workflow

1. Upload a video with a rig variant.
2. **Process** — extracts 30 fps landmarks and writes all coordinate layers.
3. Mark **start/end frames**, add a **word prompt** (e.g. `"wave hello with left hand"`).
4. **Build matrix** — normalizes joint trajectories for search/blending.
5. **Export JSON** — frame bundle compatible with rig replay experiments.

## Notes

- Processing requires a visible human pose for useful matrices; test patterns may yield empty body tracks.
- `pipeline_version` is stored on each video for reprocessing when mapping code changes.
- SQLite DB and `data/` are gitignored.
