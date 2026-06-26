"""TripoSR FastAPI service — single image in, 3D mesh out.

Send any image to POST /generate and get back a mesh (GLB by default, OBJ on
request). The TripoSR model is loaded lazily on the first request so the process
starts fast and `/health` works even before the weights are resident.

Config via environment variables (all optional):

  TRIPOSR_PATH        Path to the cloned TripoSR repo (so we can import `tsr`).
                      Defaults to ./vendor/TripoSR next to this file.
  TRIPO_DEVICE        auto | cuda | mps | cpu          (default: auto)
  TRIPO_CHUNK_SIZE    Renderer chunk size, lower = less VRAM (default: 8192)
  TRIPO_MC_RESOLUTION Marching-cubes grid resolution    (default: 256)
  TRIPO_FOREGROUND    Foreground resize ratio 0-1       (default: 0.85)
  TRIPO_MODEL_ID      HF repo id                        (default: stabilityai/TripoSR)
  TRIPO_API_KEY       If set, requests must send  X-API-Key: <key>  (default: off)
  TRIPO_REMBG         1 to remove background, 0 to skip (default: 1)
"""

from __future__ import annotations

import io
import os
import sys
import time
import threading
from pathlib import Path

import numpy as np
from PIL import Image
from fastapi import FastAPI, File, Header, HTTPException, Query, UploadFile
from fastapi.responses import JSONResponse, Response

# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #

HERE = Path(__file__).resolve().parent
TRIPOSR_PATH = Path(os.environ.get("TRIPOSR_PATH", HERE / "vendor" / "TripoSR"))
DEVICE_PREF = os.environ.get("TRIPO_DEVICE", "auto").lower()
CHUNK_SIZE = int(os.environ.get("TRIPO_CHUNK_SIZE", "8192"))
MC_RESOLUTION = int(os.environ.get("TRIPO_MC_RESOLUTION", "256"))
FOREGROUND_RATIO = float(os.environ.get("TRIPO_FOREGROUND", "0.85"))
MODEL_ID = os.environ.get("TRIPO_MODEL_ID", "stabilityai/TripoSR")
API_KEY = os.environ.get("TRIPO_API_KEY", "").strip()
USE_REMBG = os.environ.get("TRIPO_REMBG", "1") != "0"

# Make the vendored TripoSR repo importable (the `tsr` package lives at its root).
if TRIPOSR_PATH.exists():
    sys.path.insert(0, str(TRIPOSR_PATH))

# --------------------------------------------------------------------------- #
# Lazy model state — loaded once, guarded by a lock so concurrent first
# requests don't double-load.
# --------------------------------------------------------------------------- #

_lock = threading.Lock()
_state: dict = {"model": None, "rembg": None, "device": None, "loaded_at": None}


def _pick_device() -> str:
    import torch

    if DEVICE_PREF != "auto":
        return DEVICE_PREF
    if torch.cuda.is_available():
        return "cuda"
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def _ensure_model() -> dict:
    """Load TripoSR + rembg session once. Raises a clear error if the vendored
    repo or its deps are missing."""
    if _state["model"] is not None:
        return _state

    with _lock:
        if _state["model"] is not None:  # re-check inside the lock
            return _state

        if not TRIPOSR_PATH.exists():
            raise RuntimeError(
                f"TripoSR repo not found at {TRIPOSR_PATH}. Run setup.sh first "
                "(it clones VAST-AI-Research/TripoSR and installs its deps)."
            )

        try:
            import torch
            from tsr.system import TSR
        except Exception as exc:  # pragma: no cover - env dependent
            raise RuntimeError(
                f"Could not import TripoSR deps: {exc}. Activate the venv created "
                "by setup.sh and ensure torch is installed."
            ) from exc

        device = _pick_device()
        t0 = time.time()
        model = TSR.from_pretrained(
            MODEL_ID, config_name="config.yaml", weight_name="model.ckpt"
        )
        model.renderer.set_chunk_size(CHUNK_SIZE)
        model.to(device)

        rembg_session = None
        if USE_REMBG:
            import rembg

            rembg_session = rembg.new_session()

        _state.update(
            model=model,
            rembg=rembg_session,
            device=device,
            loaded_at=time.time(),
        )
        print(f"[tripo-api] model loaded on {device} in {time.time() - t0:.1f}s")
        return _state


def _prepare_image(raw: bytes, foreground_ratio: float) -> "Image.Image":
    """Decode bytes, optionally strip the background, center the foreground on a
    neutral gray plate (what TripoSR was trained to expect)."""
    from tsr.utils import remove_background, resize_foreground

    image = Image.open(io.BytesIO(raw)).convert("RGB")

    if USE_REMBG and _state["rembg"] is not None:
        image = remove_background(image, _state["rembg"])
        image = resize_foreground(image, foreground_ratio)
        arr = np.array(image).astype(np.float32) / 255.0
        if arr.shape[-1] == 4:  # composite RGBA over gray
            arr = arr[:, :, :3] * arr[:, :, 3:4] + (1 - arr[:, :, 3:4]) * 0.5
        image = Image.fromarray((arr * 255.0).astype(np.uint8))

    return image


def _run(image: "Image.Image", mc_resolution: int):
    import torch

    model = _state["model"]
    device = _state["device"]
    with torch.no_grad():
        scene_codes = model([image], device=device)

    # extract_mesh signature changed across TripoSR versions; try the vertex-color
    # form first, fall back to the older positional form.
    try:
        meshes = model.extract_mesh(
            scene_codes, has_vertex_color=True, resolution=mc_resolution
        )
    except TypeError:
        meshes = model.extract_mesh(scene_codes, resolution=mc_resolution)
    return meshes[0]


# --------------------------------------------------------------------------- #
# App
# --------------------------------------------------------------------------- #

app = FastAPI(title="TripoSR API", version="1.0.0")


def _check_key(provided: str | None) -> None:
    if API_KEY and provided != API_KEY:
        raise HTTPException(status_code=401, detail="invalid or missing X-API-Key")


@app.get("/health")
def health():
    return {
        "status": "ok",
        "model_loaded": _state["model"] is not None,
        "device": _state["device"],
        "model_id": MODEL_ID,
        "triposr_path_exists": TRIPOSR_PATH.exists(),
        "auth_required": bool(API_KEY),
    }


@app.post("/generate")
async def generate(
    image: UploadFile = File(...),
    format: str = Query("glb", pattern="^(glb|obj)$"),
    mc_resolution: int = Query(MC_RESOLUTION, ge=32, le=512),
    foreground_ratio: float = Query(FOREGROUND_RATIO, gt=0.0, le=1.0),
    x_api_key: str | None = Header(default=None),
):
    """Image -> mesh. Returns the binary mesh with the right content type and a
    download filename. `format=glb` (default) or `format=obj`."""
    _check_key(x_api_key)

    raw = await image.read()
    if not raw:
        raise HTTPException(status_code=400, detail="empty image upload")

    try:
        _ensure_model()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    t0 = time.time()
    try:
        prepared = _prepare_image(raw, foreground_ratio)
        mesh = _run(prepared, mc_resolution)
        data = mesh.export(file_type=format)
        if isinstance(data, str):  # OBJ exports as text
            data = data.encode("utf-8")
    except Exception as exc:  # pragma: no cover - runtime/model errors
        raise HTTPException(status_code=500, detail=f"generation failed: {exc}") from exc

    media = "model/gltf-binary" if format == "glb" else "text/plain"
    stem = Path(image.filename or "model").stem or "model"
    headers = {
        "Content-Disposition": f'attachment; filename="{stem}.{format}"',
        "X-Generation-Seconds": f"{time.time() - t0:.2f}",
        "X-Device": _state["device"] or "unknown",
    }
    return Response(content=bytes(data), media_type=media, headers=headers)


@app.post("/warmup")
def warmup(x_api_key: str | None = Header(default=None)):
    """Force-load the model now (useful right after boot so the first real
    request isn't slow)."""
    _check_key(x_api_key)
    try:
        _ensure_model()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return JSONResponse({"status": "ready", "device": _state["device"]})
