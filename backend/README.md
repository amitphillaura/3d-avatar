# Motion Library Backend

Local API for importing videos, extracting MediaPipe landmarks, enriching them into
Skeleton 2D + Mushy 3D coordinates, tagging motion segments, and building search matrices.

## Setup (once)

```bash
npm run backend:setup
```

Creates `backend/.venv` and installs Python deps (MediaPipe, OpenCV, **Ultralytics
YOLO**). Model files download automatically on first run: MediaPipe `.task` files into
`backend/models/`, and YOLO weights (e.g. `yolov8s.pt`) into the process working
directory (gitignored).

> `backend/.venv` is gitignored and per-checkout. Run `npm run backend:setup` once in
> **each** working tree that serves the backend (prod runs from the main checkout).

## Run

```bash
npm run backend          # API → http://127.0.0.1:5190
npm run dev              # Pose tester + /api proxy
npm run start:full       # build + backend + prod UI on :5180
```

UI: embedded in the main page (lower-right dock) at http://127.0.0.1:5180/ (or http://127.0.0.1:5173/ in dev). `/motion.html` redirects to `/`.

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
| L0 | `raw` | MediaPipe Holistic Tasks (`holistic_landmarker.task`) |
| L1 | `skeleton_2d` | `backend/lib/skeleton2d.js` |
| L2 | `rig` | `src/poseSkeleton.js` via `backend/lib/rig3d.js` |
| L3 | segment `matrix` | root-relative joint trajectories + search vector |

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/videos` | List videos |
| POST | `/api/videos` | Upload (`multipart`: `file`, `rig_variant`, `tracking_mode`) |
| DELETE | `/api/videos/:id` | Delete video, segments, and on-disk assets |
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
| POST | `/api/detect/image` | YOLO object detection on a frame (`{ imageBase64, confidence }` or `multipart` `image`) |
| POST | `/api/detect/video-frame` | Detect on a stored processed frame (`{ videoId, frameIndex, confidence }`) |
| POST | `/api/detect/auto-tag` | Sample a processed video's frames and insert detected object classes as tags |

## Segment workflow

1. Upload a video with a rig variant.
2. **Process** — extracts 30 fps landmarks and writes all coordinate layers.
3. Mark **start/end frames**, add a **word prompt** (e.g. `"wave hello with left hand"`).
4. **Build matrix** — normalizes joint trajectories for search/blending.
5. **Export JSON** — frame bundle compatible with rig replay experiments.
6. **Play in Rig** — opens the pose tester at `/?replay=<segment_id>` for hero + skeleton playback.

## Search

Word search scores segment labels, tags, descriptions, and simple motion-shape heuristics from built matrices (wave, bow, jump, dance, arm raise).

## Object detection

YOLO-based object detection for the **Object Detection** tool (live camera, video file,
and multi-object views). Used standalone and to auto-tag uploaded videos by object class.

**Pipeline.** The frontend ([`src/objectDetection.js`](../src/objectDetection.js)) grabs a
video frame, downscales it to 640 px on the long edge, JPEG-encodes it, and POSTs it to
`/api/detect/image`. The route ([`backend/routes/detection.js`](routes/detection.js))
writes a temp file and hands it to a **persistent Python worker**
([`backend/worker/detect.py`](worker/detect.py)) over newline-delimited JSON on stdin/stdout
— the model loads once and stays warm. The response is normalized boxes
(`{ class, confidence, box:{x,y,w,h} }`, all 0–1) that the frontend draws as a canvas
overlay. The temp frame is cleaned up **after** detection resolves (the `runDetect` call is
awaited — otherwise the `finally` deletes the frame before the worker can read it).

**Acceleration & model.** The worker runs on the Apple GPU (**MPS**) or CUDA when
available, falling back to CPU, and warms the GPU with one throwaway inference at startup.
The default model is `yolov8s` (good accuracy/speed balance). Tune via env:

| Env var | Default | Effect |
|---------|---------|--------|
| `DETECT_MODEL` | `yolov8s.pt` | `yolov8n.pt` (fastest), `yolov8m.pt` (most accurate), … |
| `DETECT_PYTHON` | `backend/.venv/bin/python3` if present, else `python3` | Override the Python used for the worker |

Frontend tuning lives in `src/objectDetection.js`: `SAMPLE_INTERVAL_MS` (frame-rate floor,
the loop self-paces by elapsed time) and `MAX_FRAME_EDGE` (downscale cap).

**Troubleshooting — camera works but nothing is detected:**
- `404` on `/api/detect/*` → routes not registered in `backend/server.js`
  (`registerDetectionRoutes(app)`).
- 200 with empty `detections` and no error → Ultralytics not installed in the venv the
  worker uses. Confirm with `backend/.venv/bin/python3 -c "import ultralytics"`; if it
  fails, run `npm run backend:setup`.

## Notes

- Processing requires a visible human pose for useful matrices; test patterns may yield empty body tracks.
- `pipeline_version` is stored on each video for reprocessing when mapping code changes.
- Segment `start_frame`/`end_frame` must fit inside processed `frame_count` (max 500 frames per segment/export).
- Failed or interrupted jobs discard partial landmark files; restart recovery clears stuck `processing` rows.
- SQLite DB and `data/` are gitignored.
