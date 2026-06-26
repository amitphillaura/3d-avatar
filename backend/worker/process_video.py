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
    "pose": (
        "pose_landmarker_full.task",
        "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task",
    ),
    "face": (
        "face_landmarker.task",
        "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task",
    ),
    "hand": (
        "hand_landmarker.task",
        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task",
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

    pose = vision.PoseLandmarker.create_from_options(
        vision.PoseLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(ensure_model("pose"))),
            running_mode=running_mode,
            num_poses=1,
        )
    )
    face = vision.FaceLandmarker.create_from_options(
        vision.FaceLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(ensure_model("face"))),
            running_mode=running_mode,
            num_faces=1,
        )
    )
    hands = vision.HandLandmarker.create_from_options(
        vision.HandLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(ensure_model("hand"))),
            running_mode=running_mode,
            num_hands=2,
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

                pose_result = pose.detect(mp_image)
                face_result = face.detect(mp_image)
                hand_result = hands.detect(mp_image)

                pose_landmarks = None
                if pose_result.pose_landmarks:
                    pose_landmarks = list_to_dicts(pose_result.pose_landmarks[0])

                face_landmarks = None
                if face_result.face_landmarks:
                    face_landmarks = list_to_dicts(face_result.face_landmarks[0], include_visibility=False)

                left_hand = right_hand = None
                if hand_result.hand_landmarks:
                    for idx, landmarks in enumerate(hand_result.hand_landmarks):
                        label = (
                            hand_result.handedness[idx][0].category_name.lower()
                            if hand_result.handedness
                            else ""
                        )
                        mapped = list_to_dicts(landmarks)
                        if label == "left":
                            left_hand = mapped
                        elif label == "right":
                            right_hand = mapped

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
    pose.close()
    face.close()
    hands.close()

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
