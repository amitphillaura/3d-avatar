"""
process_video_animal.py — Two-stage animal pose extractor.

Stage 1: YOLO object detection (find animal bounding box).
Stage 2: MMPose AP-10K pose estimation (17 quadruped keypoints).

Graceful fallback: if mmpose is not installed, outputs animal bounding box with
empty keypoints list and emits a warning to stderr.

Output JSON schema:
  { kind: "animal", model: "ap10k", frames: [...] }

Each frame:
  {
    frame_index: int,
    timestamp_ms: float,
    animal: null | {
      keypoints: [{x, y, confidence}],  # 17 items (empty list if mmpose missing)
      box: {x, y, w, h}                 # normalised 0-1 coords
    }
  }

AP-10K keypoint order (0-indexed):
  0=nose, 1=left_eye, 2=right_eye, 3=neck, 4=tail_base,
  5=L_shoulder, 6=L_elbow, 7=L_front_paw, 8=R_shoulder, 9=R_elbow, 10=R_front_paw,
  11=L_hip, 12=L_knee, 13=L_hind_paw, 14=R_hip, 15=R_knee, 16=R_hind_paw
"""

import argparse
import json
import sys
import warnings

import cv2
import numpy as np

# ---------------------------------------------------------------------------
# Optional mmpose import — graceful degradation if not available
# ---------------------------------------------------------------------------
try:
    from mmpose.apis import init_model as mmpose_init_model, inference_topdown
    from mmpose.utils import adapt_mmdet_pipeline  # noqa: F401 — may be needed for pipeline prep
    MMPOSE_AVAILABLE = True
except ImportError:
    MMPOSE_AVAILABLE = False
    print(
        "WARNING: mmpose is not installed. Animal pose estimation will use YOLO bounding "
        "boxes only (no keypoints). Install with: pip install mmpose>=1.1.0",
        file=sys.stderr,
    )

from ultralytics import YOLO

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
QUADRUPED_CLASSES = {"dog", "cat", "horse", "cow", "sheep", "bear"}
PADDING_RATIO = 0.15
NUM_KEYPOINTS = 17

def parse_args():
    parser = argparse.ArgumentParser(
        description="Animal pose extractor (YOLO + MMPose AP-10K)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
AP-10K setup (required for keypoints):
  1. pip install torch torchvision  # must come first
  2. pip install mmcv mmengine mmdet mmpose
  3. Download config + checkpoint:
       mim download mmpose --config td-hm_hrnet-w32_8xb64-210e_ap10k-256x256 --dest ./checkpoints
     Or manually from:
       https://github.com/open-mmlab/mmpose/tree/main/configs/animal_2d_keypoint/topdown_heatmap/ap10k
  4. Pass --ap10k-config and --ap10k-checkpoint to this script.

Without --ap10k-config/--ap10k-checkpoint, runs YOLO-only (bounding box, no keypoints).
        """,
    )
    parser.add_argument("--video", required=True, help="Input video file path")
    parser.add_argument("--output", required=True, help="Output JSON file path")
    parser.add_argument("--fps", type=float, default=15.0, help="Target FPS for sampling (default: 15)")
    parser.add_argument(
        "--ap10k-config",
        default=None,
        help="Path to MMPose AP-10K config .py file (enables keypoint estimation)",
    )
    parser.add_argument(
        "--ap10k-checkpoint",
        default=None,
        help="Path to MMPose AP-10K checkpoint .pth file",
    )
    return parser.parse_args()


def pad_box(x1, y1, x2, y2, img_w, img_h, pad_ratio=PADDING_RATIO):
    """Expand bounding box by pad_ratio and clamp to image bounds."""
    bw = x2 - x1
    bh = y2 - y1
    pad_x = bw * pad_ratio
    pad_y = bh * pad_ratio
    x1p = max(0, int(x1 - pad_x))
    y1p = max(0, int(y1 - pad_y))
    x2p = min(img_w, int(x2 + pad_x))
    y2p = min(img_h, int(y2 + pad_y))
    return x1p, y1p, x2p, y2p


def normalise_box(x1, y1, x2, y2, img_w, img_h):
    """Return normalised (0-1) box dict {x, y, w, h} (top-left origin)."""
    return {
        "x": x1 / img_w,
        "y": y1 / img_h,
        "w": (x2 - x1) / img_w,
        "h": (y2 - y1) / img_h,
    }


def uncrop_keypoints(keypoints_in_crop, crop_x1, crop_y1, crop_w, crop_h, img_w, img_h):
    """Convert keypoints from crop-relative pixel coords back to full-frame normalised coords."""
    result = []
    for kp in keypoints_in_crop:
        px_in_full = crop_x1 + kp["x"] * crop_w
        py_in_full = crop_y1 + kp["y"] * crop_h
        result.append({
            "x": px_in_full / img_w,
            "y": py_in_full / img_h,
            "confidence": kp["confidence"],
        })
    return result


def mmpose_keypoints_from_result(pose_result):
    """Extract keypoints list [{x, y, confidence}] from an MMPose result object."""
    kps = []
    if pose_result is None:
        return kps
    try:
        pred = pose_result.pred_instances
        # pred_instances.keypoints shape: (N_instances, N_kp, 2)
        # pred_instances.keypoint_scores shape: (N_instances, N_kp)
        if len(pred.keypoints) == 0:
            return kps
        pts = pred.keypoints[0]   # first (highest-score) instance
        scores = pred.keypoint_scores[0]
        for i in range(min(NUM_KEYPOINTS, len(pts))):
            kps.append({
                "x": float(pts[i][0]),   # pixel in crop
                "y": float(pts[i][1]),
                "confidence": float(scores[i]),
            })
    except Exception as exc:
        warnings.warn(f"Could not parse mmpose keypoints: {exc}")
    return kps


def load_mmpose_model(config_path, checkpoint_path):
    """Try to load the AP-10K model; return None with a clear error if unavailable."""
    if not MMPOSE_AVAILABLE:
        return None
    if not config_path or not checkpoint_path:
        print(
            "INFO: --ap10k-config / --ap10k-checkpoint not provided. "
            "Running YOLO-only mode (bounding box, no keypoints). "
            "Pass both flags to enable full pose estimation.",
            file=sys.stderr,
        )
        return None
    import os
    missing = [p for p in [config_path, checkpoint_path] if not os.path.exists(p)]
    if missing:
        print(
            f"ERROR: MMPose file(s) not found:\n" +
            "\n".join(f"  {p}" for p in missing) +
            "\nFalling back to YOLO-only mode. Run with --help for setup instructions.",
            file=sys.stderr,
        )
        return None
    try:
        model = mmpose_init_model(config_path, checkpoint_path, device="cpu")
        return model
    except Exception as exc:
        print(f"ERROR: Failed to load MMPose model: {exc}\nFalling back to YOLO-only.", file=sys.stderr)
        return None


def process_frame(frame, yolo_model, pose_model, img_w, img_h):
    """
    Run Stage 1 (YOLO) and Stage 2 (MMPose) on a single frame.
    Returns animal dict or None if no animal detected.
    """
    results = yolo_model(frame, verbose=False)
    best_box = None
    best_conf = 0.0

    for result in results:
        boxes = result.boxes
        for i, cls_id in enumerate(boxes.cls):
            label = yolo_model.names[int(cls_id)].lower()
            if label in QUADRUPED_CLASSES:
                conf = float(boxes.conf[i])
                if conf > best_conf:
                    best_conf = conf
                    best_box = boxes.xyxy[i].tolist()  # [x1, y1, x2, y2]

    if best_box is None:
        return None

    x1, y1, x2, y2 = best_box
    cx1, cy1, cx2, cy2 = pad_box(x1, y1, x2, y2, img_w, img_h)
    norm_box = normalise_box(cx1, cy1, cx2, cy2, img_w, img_h)

    keypoints = []
    if pose_model is not None:
        crop = frame[cy1:cy2, cx1:cx2]
        crop_h, crop_w = crop.shape[:2]
        if crop_w > 0 and crop_h > 0:
            try:
                bboxes = np.array([[0, 0, crop_w, crop_h]])
                pose_results = inference_topdown(pose_model, crop, bboxes)
                if pose_results:
                    raw_kps = mmpose_keypoints_from_result(pose_results[0])
                    # raw_kps are in crop pixel space; normalise to 0-1 within crop, then uncrop
                    norm_kps = [
                        {"x": kp["x"] / crop_w, "y": kp["y"] / crop_h, "confidence": kp["confidence"]}
                        for kp in raw_kps
                    ]
                    keypoints = uncrop_keypoints(norm_kps, cx1, cy1, crop_w, crop_h, img_w, img_h)
            except Exception as exc:
                warnings.warn(f"MMPose inference failed: {exc}")

    return {"keypoints": keypoints, "box": norm_box}


def main():
    args = parse_args()

    yolo_model = YOLO("yolov8n.pt")
    pose_model = load_mmpose_model(args.ap10k_config, args.ap10k_checkpoint)

    cap = cv2.VideoCapture(args.video)
    if not cap.isOpened():
        print(f"ERROR: Cannot open video: {args.video}", file=sys.stderr)
        sys.exit(1)

    video_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 1
    img_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    img_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    # Compute frame step to hit target FPS
    step = max(1, round(video_fps / args.fps))

    frames = []
    frame_idx = 0
    output_idx = 0
    last_progress = -1

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        if frame_idx % step == 0:
            timestamp_ms = (frame_idx / video_fps) * 1000.0
            animal = process_frame(frame, yolo_model, pose_model, img_w, img_h)
            frames.append({
                "frame_index": output_idx,
                "timestamp_ms": round(timestamp_ms, 2),
                "animal": animal,
            })
            output_idx += 1

        # Emit progress
        progress = int((frame_idx / total_frames) * 100)
        if progress != last_progress and progress % 5 == 0:
            print(f"PROGRESS:{progress}", flush=True)
            last_progress = progress

        frame_idx += 1

    cap.release()
    print("PROGRESS:100", flush=True)

    output = {
        "kind": "animal",
        "model": "ap10k",
        "width": img_w,
        "height": img_h,
        "fps": args.fps,
        "duration_ms": round((frame_idx / video_fps) * 1000.0, 2),
        "frames": frames,
    }

    with open(args.output, "w") as f:
        json.dump(output, f)

    # Emit summary line for the Node.js caller to parse
    print(json.dumps({
        "width": img_w,
        "height": img_h,
        "fps": args.fps,
        "duration_ms": output["duration_ms"],
        "frame_count": len(frames),
    }), flush=True)


if __name__ == "__main__":
    main()
