#!/usr/bin/env python3
"""Image -> 3D mesh (.glb). Engine-agnostic adapter dispatch.

Phase 1 worker for the mesh API. Invoked as a subprocess by
``backend/lib/mesh.js`` exactly like ``process_video.py`` is by
``backend/lib/processor.js``::

    python3 generate_mesh.py --image <path> --output <result.glb> \
        --engine <triposr|sf3d|hunyuan3d> [--remove-bg] [--texture]

stdout protocol (mirrors process_video.py):
  * ``PROGRESS:<int>`` lines report 0-100 progress.
  * exactly one final JSON object line is the result meta.
  * everything human/diagnostic goes to **stderr**.
  * non-zero exit code signals failure (stderr carries the reason).

Adapters are kept isolated: heavy engine imports happen *inside* each
adapter, so a missing/broken engine never prevents the others from running.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

# Engine repos are cloned under backend/engines/<Engine>/ by setup-mesh-backend.sh.
# They aren't pip-installable packages, so make them importable here.
ENGINES_ROOT = Path(__file__).resolve().parent.parent / "engines"


def _add_engine_to_path(subdir: str) -> None:
    repo = ENGINES_ROOT / subdir
    if repo.is_dir() and str(repo) not in sys.path:
        sys.path.insert(0, str(repo))


def log(msg: str) -> None:
    """Diagnostic line -> stderr (never stdout, which carries the protocol)."""
    print(msg, file=sys.stderr, flush=True)


def progress(pct: float) -> None:
    print(f"PROGRESS:{int(pct)}", flush=True)


def emit(meta: dict) -> None:
    """Final single-line JSON result on stdout."""
    print(json.dumps(meta, separators=(",", ":")), flush=True)


# --------------------------------------------------------------------------- #
# TripoSR adapter — smoke test engine. Proves image -> result.glb end to end.
# --------------------------------------------------------------------------- #
def run_triposr(image_path: str, output_path: str, *, remove_bg: bool, texture: bool) -> dict:
    """VAST-AI TripoSR. Lowest quality, fastest, ~4 GB VRAM (CPU-capable).

    Reproduces the photo's pose, unrigged. Used first to prove the pipeline.
    """
    _add_engine_to_path("TripoSR")
    try:
        import numpy as np
        import torch
        from PIL import Image
        from tsr.system import TSR
        from tsr.utils import remove_background, resize_foreground
    except ImportError as exc:  # engine not installed yet
        log(
            "TripoSR not installed. Run `npm run mesh:setup` and follow the "
            "TripoSR install steps in backend/README-mesh.md.\n"
            f"  import error: {exc}"
        )
        raise SystemExit(2) from exc

    started = time.time()
    device = "cuda:0" if torch.cuda.is_available() else "cpu"
    cuda_available = torch.cuda.is_available()
    log(f"TripoSR: torch={torch.__version__} device={device} cuda_available={cuda_available}")
    progress(5)

    # Load model + weights (downloaded/cached from HF: stabilityai/TripoSR).
    model = TSR.from_pretrained(
        "stabilityai/TripoSR",
        config_name="config.yaml",
        weight_name="model.ckpt",
    )
    model.renderer.set_chunk_size(8192)  # conservative for 8 GB laptop VRAM
    model.to(device)
    progress(35)

    # Preprocess: optional background removal + foreground compositing onto gray.
    img = Image.open(image_path)
    if remove_bg:
        import rembg

        log("Removing background (rembg)…")
        session = rembg.new_session()
        img = remove_background(img, session)
        img = resize_foreground(img, 0.85)
        arr = np.array(img).astype(np.float32) / 255.0
        arr = arr[:, :, :3] * arr[:, :, 3:4] + (1 - arr[:, :, 3:4]) * 0.5
        img = Image.fromarray((arr * 255.0).astype(np.uint8))
    else:
        img = img.convert("RGB")
    progress(50)

    # Inference.
    with torch.no_grad():
        scene_codes = model([img], device=device)
    progress(75)

    # Extract a single mesh. has_vertex_color bakes the photo colors as vertex
    # colors (TripoSR has no UV texture model; --texture toggles vertex color).
    meshes = model.extract_mesh(scene_codes, has_vertex_color=bool(texture), resolution=256)
    mesh = meshes[0]
    progress(90)

    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    mesh.export(str(out))  # trimesh: .glb -> binary glTF (model/gltf-binary)
    progress(100)

    if device.startswith("cuda"):
        torch.cuda.empty_cache()

    return {
        "engine": "triposr",
        "output": str(out),
        "vertices": int(len(mesh.vertices)),
        "faces": int(len(mesh.faces)),
        "device": device,
        "cuda_available": bool(cuda_available),
        "remove_bg": bool(remove_bg),
        "texture": bool(texture),
        "seconds": round(time.time() - started, 2),
    }


def run_sf3d(*_args, **_kwargs) -> dict:
    raise SystemExit(_not_installed("sf3d", "Stable Fast 3D"))


def run_hunyuan3d(*_args, **_kwargs) -> dict:
    raise SystemExit(_not_installed("hunyuan3d", "Hunyuan3D 2.1"))


def _not_installed(engine: str, name: str) -> int:
    log(
        f"Engine '{engine}' ({name}) is not installed yet. Phase 1 ships the "
        f"TripoSR smoke-test engine first; add this engine later without code "
        f"changes (it's a config flag)."
    )
    return 3


ENGINES = {
    "triposr": run_triposr,
    "sf3d": run_sf3d,
    "hunyuan3d": run_hunyuan3d,
}


def main() -> int:
    parser = argparse.ArgumentParser(description="Image -> 3D mesh (.glb)")
    parser.add_argument("--image", required=True, help="input image path")
    parser.add_argument("--output", required=True, help="output result.glb path")
    parser.add_argument("--engine", default="triposr", choices=sorted(ENGINES))
    parser.add_argument("--remove-bg", action="store_true", help="rembg background removal")
    parser.add_argument("--texture", action="store_true", help="bake vertex colors")
    args = parser.parse_args()

    image_path = Path(args.image)
    if not image_path.exists():
        log(f"Input image not found: {image_path}")
        return 1

    adapter = ENGINES[args.engine]
    progress(0)
    meta = adapter(
        str(image_path),
        args.output,
        remove_bg=args.remove_bg,
        texture=args.texture,
    )
    emit(meta)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
