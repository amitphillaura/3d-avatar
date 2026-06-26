#!/usr/bin/env python3
"""
YOLO object detection worker — persistent mode.

Run as a long-lived process: reads newline-delimited JSON requests from stdin,
writes newline-delimited JSON responses to stdout. The model loads once on
startup and stays warm for all subsequent requests, eliminating the ~2-3s
cold-start penalty on each HTTP call.

Protocol (one JSON object per line):
  Request:  {"image_path": "...", "confidence": 0.4}
  Response: {"detections": [...]}  or  {"error": "...", "detections": []}
"""

import os
import sys
import json

_model = None
_device = None

# Model weights: yolov8s ("small") gives noticeably better accuracy than the
# nano default at negligible cost on GPU. Override with DETECT_MODEL=yolov8n.pt
# (faster) or yolov8m.pt (more accurate).
MODEL_NAME = os.environ.get("DETECT_MODEL", "yolov8s.pt")

def get_device():
    """Prefer Apple GPU (MPS) / CUDA over CPU for a large inference speedup."""
    global _device
    if _device is not None:
        return _device
    _device = "cpu"
    try:
        import torch
        if torch.backends.mps.is_available():
            _device = "mps"
        elif torch.cuda.is_available():
            _device = "cuda"
    except Exception:
        pass
    return _device

def get_model():
    global _model
    if _model is not None:
        return _model
    try:
        from ultralytics import YOLO
        _model = YOLO(MODEL_NAME)
        return _model
    except ImportError:
        return None

def run_detection(image_path, confidence=0.4):
    model = get_model()
    if model is None:
        return {"error": "ultralytics not installed", "detections": []}

    try:
        results = model(image_path, conf=confidence, device=get_device(), verbose=False)
    except Exception as e:
        sys.stderr.write(f"Detection error: {e}\n")
        return {"error": str(e), "detections": []}

    detections = []
    for result in results:
        if result.boxes is None:
            continue
        img_w = result.orig_shape[1]
        img_h = result.orig_shape[0]
        for box in result.boxes:
            cls_id = int(box.cls[0])
            cls_name = result.names[cls_id]
            conf = float(box.conf[0])
            if conf < confidence:
                continue
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            detections.append({
                "class": cls_name,
                "confidence": round(conf, 4),
                "box": {
                    "x": round(x1 / img_w, 4),
                    "y": round(y1 / img_h, 4),
                    "w": round((x2 - x1) / img_w, 4),
                    "h": round((y2 - y1) / img_h, 4),
                },
            })
    return {"detections": detections}

def main():
    # Warm the model on startup so the first request doesn't pay the load cost.
    model = get_model()
    if model is None:
        sys.stdout.write(json.dumps({"error": "ultralytics not installed", "detections": []}) + "\n")
        sys.stdout.flush()
    else:
        # Run one throwaway inference so the GPU (MPS/CUDA) graph is compiled
        # before the first real frame arrives.
        try:
            import numpy as np
            model(np.zeros((640, 640, 3), dtype="uint8"), device=get_device(), verbose=False)
        except Exception:
            pass

    # Read requests line-by-line (persistent worker loop).
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            payload = json.loads(line)
        except Exception as e:
            sys.stdout.write(json.dumps({"error": f"Invalid JSON: {e}", "detections": []}) + "\n")
            sys.stdout.flush()
            continue

        image_path = payload.get("image_path", "")
        confidence = float(payload.get("confidence", 0.4))

        if not image_path:
            sys.stdout.write(json.dumps({"error": "image_path required", "detections": []}) + "\n")
        else:
            result = run_detection(image_path, confidence)
            sys.stdout.write(json.dumps(result) + "\n")
        sys.stdout.flush()

if __name__ == "__main__":
    main()
