#!/usr/bin/env python3
"""Image -> 3D mesh (.glb). Engine-agnostic adapter dispatch.

Phase 1 worker for the mesh API. Invoked as a subprocess by
``backend/lib/mesh.js`` exactly like ``process_video.py`` is by
``backend/lib/processor.js``::

    python3 generate_mesh.py --image <path> --output <result.glb> \
        --engine <triposr|sf3d|hunyuan3d> [--remove-bg] [--texture] [--no-normalize]

stdout protocol (mirrors process_video.py):
  * ``PROGRESS:<int>`` lines report 0-100 progress.
  * exactly one final JSON object line is the result meta (success) OR an
    object ``{"error": {"code","message","stage"}}`` (failure, non-zero exit).
  * everything human/diagnostic goes to **stderr**.

Adapters are kept isolated: heavy engine imports happen *inside* each adapter,
so a missing/broken engine never prevents the others from running.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

ENGINES_ROOT = Path(__file__).resolve().parent.parent / "engines"


def _add_engine_to_path(subdir: str) -> None:
    repo = ENGINES_ROOT / subdir
    if repo.is_dir() and str(repo) not in sys.path:
        sys.path.insert(0, str(repo))


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def progress(pct: float) -> None:
    print(f"PROGRESS:{int(pct)}", flush=True)


def emit(meta: dict) -> None:
    print(json.dumps(meta, separators=(",", ":")), flush=True)


class WorkerError(Exception):
    """Carries a structured (code, stage) for the client."""

    def __init__(self, code: str, message: str, stage: str):
        super().__init__(message)
        self.code = code
        self.message = message
        self.stage = stage


# --------------------------------------------------------------------------- #
# Shared mesh post-processing (engine-agnostic)
# --------------------------------------------------------------------------- #
def normalize_mesh(mesh) -> dict:
    """Reorient to a canonical upright pose, then center + unit-scale.

    TripoSR emits a Z-up mesh; glTF/Three.js viewers are Y-up, so the raw output
    renders lying-down. We rotate to glTF-canonical (height along +Y, front along
    +Z) — the rotation was verified by rendering the four cardinal sides — then
    center at the origin and uniform-scale to fit a unit cube. The applied
    transform is reported so a client can invert it if needed. Order: rotate,
    then translate, then scale."""
    import numpy as np
    from trimesh.transformations import rotation_matrix

    # Z-up -> Y-up (Rx -90), then turn the front to face +Z (Ry -90).
    R = rotation_matrix(-np.pi / 2, [0, 1, 0]) @ rotation_matrix(-np.pi / 2, [1, 0, 0])
    mesh.apply_transform(R)

    center = mesh.bounds.mean(axis=0)
    mesh.apply_translation(-center)
    extents = mesh.extents
    maxdim = float(np.max(extents)) or 1.0
    mesh.apply_scale(1.0 / maxdim)
    return {
        "applied": True,
        "reorient": "triposr_z_up -> gltf_y_up, front +Z",
        "rotation_deg": {"x": -90, "y": -90, "order": "Rx then Ry"},
        "translate": [float(-c) for c in center],  # post-rotation center
        "scale": float(1.0 / maxdim),
        "fit": "unit-cube",
        "up_axis": "Y",
        "front_axis": "+Z",
    }


def mesh_metadata(mesh, output_path: str) -> dict:
    bounds = mesh.bounds
    dims = bounds[1] - bounds[0]
    kind = getattr(getattr(mesh, "visual", None), "kind", None)
    uv = getattr(getattr(mesh, "visual", None), "uv", None)
    has_uv_texture = uv is not None
    return {
        "bytes": int(os.path.getsize(output_path)),
        "vertices": int(len(mesh.vertices)),
        "triangles": int(len(mesh.faces)),
        "has_texture": bool(has_uv_texture),       # real UV/material texture
        "vertex_colors": kind == "vertex",
        "color_source": "vertex" if kind == "vertex" else "none",
        "bbox": [[float(x) for x in bounds[0]], [float(x) for x in bounds[1]]],
        "dimensions": [float(x) for x in dims],
        "up_axis": "Y",
    }


def save_thumbnail(mesh, path: str) -> bool:
    """Best-effort shaded PNG render for job-history previews. Never fatal."""
    try:
        import io

        import numpy as np
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        from mpl_toolkits.mplot3d.art3d import Poly3DCollection

        V = np.asarray(mesh.vertices)
        F = np.asarray(mesh.faces)
        try:
            base = np.asarray(mesh.visual.vertex_colors)[:, :3] / 255.0
            fc = base[F].mean(axis=1)
        except Exception:
            fc = np.full((len(F), 3), 0.72)
        n = np.asarray(mesh.face_normals)
        light = np.array([0.4, 0.5, 0.75]); light /= np.linalg.norm(light)
        shade = np.clip(n @ light, 0, 1) * 0.65 + 0.35
        fc = np.clip(fc * shade[:, None], 0, 1)

        fig = plt.figure(figsize=(3.4, 3.4), dpi=120)
        ax = fig.add_subplot(111, projection="3d")
        ax.add_collection3d(Poly3DCollection(V[F], facecolors=fc, linewidths=0))
        ctr = V.mean(0); rad = float(np.linalg.norm(V - ctr, axis=1).max()) or 1.0
        ax.set_xlim(ctr[0] - rad, ctr[0] + rad)
        ax.set_ylim(ctr[1] - rad, ctr[1] + rad)
        ax.set_zlim(ctr[2] - rad, ctr[2] + rad)
        ax.set_box_aspect((1, 1, 1)); ax.view_init(elev=18, azim=-60); ax.set_axis_off()
        fig.savefig(path, format="png", transparent=True, bbox_inches="tight", pad_inches=0)
        plt.close(fig)
        return True
    except Exception as exc:  # thumbnails are optional
        log(f"thumbnail render skipped: {exc}")
        return False


# --------------------------------------------------------------------------- #
# TripoSR adapter — smoke test engine.
# --------------------------------------------------------------------------- #
def run_triposr(image_path, output_path, *, remove_bg, texture, normalize, job_dir):
    _add_engine_to_path("TripoSR")
    try:
        import numpy as np
        import torch
        from PIL import Image
        from tsr.system import TSR
        from tsr.utils import remove_background, resize_foreground
    except ImportError as exc:
        raise WorkerError(
            "engine_not_installed",
            f"TripoSR not installed ({exc}). Run `npm run mesh:setup`.",
            "model_load",
        ) from exc

    started = time.time()
    device = "cuda:0" if torch.cuda.is_available() else "cpu"
    cuda_available = torch.cuda.is_available()
    log(f"TripoSR: torch={torch.__version__} device={device} cuda={cuda_available}")
    progress(5)

    stage = "model_load"
    try:
        model = TSR.from_pretrained(
            "stabilityai/TripoSR", config_name="config.yaml", weight_name="model.ckpt"
        )
        model.renderer.set_chunk_size(8192)
        model.to(device)
        progress(35)

        stage = "preprocess"
        img = Image.open(image_path)
        if remove_bg:
            import rembg

            log("Removing background (rembg)…")
            session = rembg.new_session()
            img = remove_background(img, session)
            img = resize_foreground(img, 0.85)
            # Persist the exact cutout TripoSR saw (RGBA) for the client.
            try:
                img.save(str(Path(job_dir) / "input_cutout.png"))
            except Exception as exc:
                log(f"cutout save skipped: {exc}")
            arr = np.array(img).astype(np.float32) / 255.0
            arr = arr[:, :, :3] * arr[:, :, 3:4] + (1 - arr[:, :, 3:4]) * 0.5
            img = Image.fromarray((arr * 255.0).astype(np.uint8))
        else:
            img = img.convert("RGB")
        progress(50)

        stage = "inference"
        with torch.no_grad():
            scene_codes = model([img], device=device)
        progress(75)

        stage = "export"
        meshes = model.extract_mesh(scene_codes, has_vertex_color=bool(texture), resolution=256)
        mesh = meshes[0]
    except torch.cuda.OutOfMemoryError as exc:
        torch.cuda.empty_cache()
        raise WorkerError("oom", f"CUDA out of memory during {stage}", stage) from exc
    except RuntimeError as exc:
        if "out of memory" in str(exc).lower():
            torch.cuda.empty_cache()
            raise WorkerError("oom", str(exc), stage) from exc
        raise WorkerError(f"{stage}_failed", str(exc), stage) from exc

    transform = normalize_mesh(mesh) if normalize else {"applied": False}
    progress(88)

    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    try:
        mesh.export(str(out))
    except Exception as exc:
        raise WorkerError("export_failed", str(exc), "export") from exc
    progress(94)

    meta = mesh_metadata(mesh, str(out))
    meta["normalize"] = transform
    # Honest axes: only claim Y-up/front-+Z when we actually reoriented.
    meta["up_axis"] = "Y" if transform.get("applied") else "Z"
    meta["front_axis"] = "+Z" if transform.get("applied") else None
    thumb_ok = save_thumbnail(mesh, str(Path(job_dir) / "thumbnail.png"))
    progress(100)

    if device.startswith("cuda"):
        torch.cuda.empty_cache()

    return {
        "engine": "triposr",
        "device": device,
        "cuda_available": bool(cuda_available),
        "seconds": round(time.time() - started, 2),
        "result": meta,
        "params_applied": {
            "remove_bg": bool(remove_bg),
            # TripoSR has no UV/material model — be honest about it.
            "texture": False,
            "color_source": meta["color_source"],
            "normalize": bool(normalize),
        },
        "artifacts": {
            "input_cutout": bool(remove_bg),
            "thumbnail": bool(thumb_ok),
        },
    }


def _not_installed(engine: str, name: str):
    raise WorkerError(
        "engine_not_installed",
        f"Engine '{engine}' ({name}) is not installed yet.",
        "model_load",
    )


def run_sf3d(*_a, **_k):
    _not_installed("sf3d", "Stable Fast 3D")


def run_hunyuan3d(*_a, **_k):
    _not_installed("hunyuan3d", "Hunyuan3D 2.1")


ENGINES = {"triposr": run_triposr, "sf3d": run_sf3d, "hunyuan3d": run_hunyuan3d}


def main() -> int:
    parser = argparse.ArgumentParser(description="Image -> 3D mesh (.glb)")
    parser.add_argument("--image", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--engine", default="triposr", choices=sorted(ENGINES))
    parser.add_argument("--remove-bg", action="store_true")
    parser.add_argument("--texture", action="store_true")
    parser.add_argument("--no-normalize", dest="normalize", action="store_false")
    parser.set_defaults(normalize=True)
    args = parser.parse_args()

    progress(0)
    try:
        image_path = Path(args.image)
        if not image_path.exists():
            raise WorkerError("bad_image", f"Input image not found: {image_path}", "preprocess")
        meta = ENGINES[args.engine](
            str(image_path),
            args.output,
            remove_bg=args.remove_bg,
            texture=args.texture,
            normalize=args.normalize,
            job_dir=str(Path(args.output).parent),
        )
        emit(meta)
        return 0
    except WorkerError as e:
        log(f"FAILED [{e.code}@{e.stage}]: {e.message}")
        emit({"error": {"code": e.code, "message": e.message, "stage": e.stage}})
        return 1
    except Exception as e:  # last-resort
        import traceback

        traceback.print_exc()
        emit({"error": {"code": "worker_failed", "message": str(e), "stage": "unknown"}})
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
