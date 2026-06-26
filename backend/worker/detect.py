#!/usr/bin/env python3
"""
YOLO object detection worker.
Reads JSON from stdin: {"image_path": "...", "confidence": 0.4}
Writes JSON to stdout: {"detections": [...]}
"""

import sys
import json

def load_model():
    try:
        from ultralytics import YOLO
        model = YOLO("yolov8n.pt")
        return model
    except ImportError:
        print(json.dumps({"error": "ultralytics not installed", "detections": []}), flush=True)
        return None

_model = None

def get_model():
    global _model
    if _model is None:
        _model = load_model()
    return _model

def run_detection(image_path, confidence=0.4):
    model = get_model()
    if model is None:
        return []

    try:
        results = model(image_path, conf=confidence, verbose=False)
    except Exception as e:
        sys.stderr.write(f"Detection error: {e}\n")
        return []

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
            # xyxy absolute pixels
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            # normalize to 0-1
            x = x1 / img_w
            y = y1 / img_h
            w = (x2 - x1) / img_w
            h = (y2 - y1) / img_h
            detections.append({
                "class": cls_name,
                "confidence": round(conf, 4),
                "box": {
                    "x": round(x, 4),
                    "y": round(y, 4),
                    "w": round(w, 4),
                    "h": round(h, 4)
                }
            })
    return detections

def main():
    try:
        raw = sys.stdin.read()
        payload = json.loads(raw)
    except Exception as e:
        print(json.dumps({"error": f"Invalid input: {e}", "detections": []}), flush=True)
        sys.exit(0)

    image_path = payload.get("image_path", "")
    confidence = float(payload.get("confidence", 0.4))

    if not image_path:
        print(json.dumps({"error": "image_path required", "detections": []}), flush=True)
        sys.exit(0)

    detections = run_detection(image_path, confidence)
    print(json.dumps({"detections": detections}), flush=True)

if __name__ == "__main__":
    main()
