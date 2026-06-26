#!/usr/bin/env python3
"""Extract pose/face/hand landmarks from video using MediaPipe Tasks (Holistic-equivalent)."""

from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from pathlib import Path

try:
    import cv2
    import mediapipe as mp
    from mediapipe.tasks.python import vision
    from mediapipe.tasks.python.core import base_options as base_options_module
except ImportError as exc:
    print("Missing dependencies. Run: npm run backend:setup", file=sys.stderr)
    raise SystemExit(2) from exc


MODELS = {
    "holistic": (
        "holistic_landmarker.task",
        "https://storage.googleapis.com/mediapipe-models/holistic_landmarker/holistic_landmarker/float16/latest/holistic_landmarker.task",
    ),
}


def models_dir() -> Path:
    return Path(__file__).resolve().parent.parent / "models"


def ensure_model(name: str) -> Path:
    filename, url = MODELS[name]
    target = models_dir() / filename
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        print(f"Downloading {filename}…", file=sys.stderr)
        urllib.request.urlretrieve(url, target)
    return target


def landmark_to_dict(landmark, include_visibility=True):
    data = {
        "x": float(landmark.x),
        "y": float(landmark.y),
        "z": float(getattr(landmark, "z", 0.0) or 0.0),
    }
    if include_visibility and hasattr(landmark, "visibility"):
        data["visibility"] = float(landmark.visibility)
    return data


def list_to_dicts(landmarks, include_visibility=True):
    if not landmarks:
        return None
    return [landmark_to_dict(item, include_visibility) for item in landmarks]


def process_video(video_path: str, output_path: str, target_fps: float) -> dict:
    capture = cv2.VideoCapture(video_path)
    if not capture.isOpened():
        raise RuntimeError(f"Could not open video: {video_path}")

    native_fps = capture.get(cv2.CAP_PROP_FPS) or target_fps
    frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    duration_ms = (frame_count / native_fps * 1000.0) if native_fps else 0.0
    step = max(native_fps / target_fps, 1.0)

    BaseOptions = base_options_module.BaseOptions
    running_mode = vision.RunningMode.IMAGE

    holistic = vision.HolisticLandmarker.create_from_options(
        vision.HolisticLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(ensure_model("holistic"))),
            running_mode=running_mode,
        )
    )

    frame_index = 0
    written = 0
    next_sample = 0.0
    source_index = 0

    with open(output_path, "w", encoding="utf-8") as handle:
        while True:
            ok, frame = capture.read()
            if not ok:
                break

            if source_index >= next_sample - 0.001:
                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

                result = holistic.detect(mp_image)

                pose_landmarks = (
                    list_to_dicts(result.pose_landmarks) if result.pose_landmarks else None
                )
                face_landmarks = (
                    list_to_dicts(result.face_landmarks, include_visibility=False)
                    if result.face_landmarks
                    else None
                )
                left_hand = (
                    list_to_dicts(result.left_hand_landmarks)
                    if result.left_hand_landmarks
                    else None
                )
                right_hand = (
                    list_to_dicts(result.right_hand_landmarks)
                    if result.right_hand_landmarks
                    else None
                )

                timestamp_ms = (source_index / native_fps) * 1000.0 if native_fps else 0.0
                payload = {
                    "frame_index": frame_index,
                    "timestamp_ms": round(timestamp_ms, 3),
                    "pose": pose_landmarks,
                    "face": face_landmarks,
                    "left_hand": left_hand,
                    "right_hand": right_hand,
                }
                handle.write(json.dumps(payload, separators=(",", ":")) + "\n")
                frame_index += 1
                written += 1
                next_sample += step

            source_index += 1

    capture.release()
    holistic.close()

    return {
        "width": width,
        "height": height,
        "fps": target_fps,
        "native_fps": native_fps,
        "duration_ms": round(duration_ms, 3),
        "frame_count": written,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--fps", type=float, default=30.0)
    args = parser.parse_args()

    meta = process_video(args.video, args.output, args.fps)
    print(json.dumps(meta, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
