import { Face } from "kalidokit";
import * as THREE from "three";
import { mapPoseLandmark } from "./poseSkeleton.js";

export const FACE_HEAD_LANDMARKS = {
  noseTip: 1,
  chin: 152,
  forehead: 10,
  leftEyeOuter: 33,
  rightEyeOuter: 263
};

export const FACE_HEAD_KEYS = Object.keys(FACE_HEAD_LANDMARKS);

const FACE_PLANE = { topLeft: 21, topRight: 251, bottomRight: 397, bottomLeft: 172 };
const FACE_HEAD_REQUIRED = ["noseTip", "leftEyeOuter", "rightEyeOuter"];
const NECK_DAMP = 0.7;
const NECK_LIMITS = { pitch: 0.5, yaw: 0.75, roll: 0.45 };
const SMOOTH_ALPHA = 0.38;
const DEFAULT_CAL = { sx: 1, sy: -1, sz: -0.4 };

const smoothState = {
  forward: new THREE.Vector3(0, 0, -1),
  up: new THREE.Vector3(0, 1, 0),
  ready: false
};

const _mapped = new THREE.Vector3();
const _right = new THREE.Vector3();
const _down = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _up = new THREE.Vector3();

function clampValue(value, min, max) {
  return Math.max(Math.min(value, max), min);
}

function proximityScale(headWidth, frameWidth) {
  if (!frameWidth || !headWidth) return 1;
  const typicalFaceWidth = frameWidth * 0.22;
  return clampValue(typicalFaceWidth / Math.max(headWidth, 1), 0.3, 1);
}

function mapFacePoint(landmark, _cal, out = _mapped) {
  return mapPoseLandmark(landmark, out);
}

function smoothDirection(current, target, alpha = SMOOTH_ALPHA) {
  if (!smoothState.ready) {
    current.copy(target);
    smoothState.ready = true;
    return current;
  }
  return current.lerp(target, alpha);
}

export function resetFaceRigSmoothing() {
  smoothState.ready = false;
}

export function isFaceHeadUsable(faceLandmarks) {
  if (!faceLandmarks?.length) return false;
  return FACE_HEAD_REQUIRED.every((key) => {
    const landmark = faceLandmarks[FACE_HEAD_LANDMARKS[key]];
    return landmark && Number.isFinite(landmark.x) && Number.isFinite(landmark.y);
  });
}

export function isFaceTracked(faceLandmarks) {
  return isFaceHeadUsable(faceLandmarks);
}

function cloneFaceLandmarks(faceLandmarks) {
  return faceLandmarks.map((landmark) => ({
    x: landmark.x,
    y: landmark.y,
    z: landmark.z ?? 0
  }));
}

/**
 * Face-plane forward/up in the same CAL space as GLB body retargeting.
 * Uses the same landmark square as Kalidokit/Mesh2Motion head solving.
 */
export function computeFaceHeadDirections(faceLandmarks, cal = DEFAULT_CAL) {
  const topLeft = mapFacePoint(faceLandmarks[FACE_PLANE.topLeft], cal);
  const topRight = mapFacePoint(faceLandmarks[FACE_PLANE.topRight], cal);
  const bottomRight = mapFacePoint(faceLandmarks[FACE_PLANE.bottomRight], cal);
  const bottomLeft = mapFacePoint(faceLandmarks[FACE_PLANE.bottomLeft], cal);

  const topMid = topLeft.clone().add(topRight).multiplyScalar(0.5);
  const bottomMid = bottomRight.clone().add(bottomLeft).multiplyScalar(0.5);

  _right.subVectors(topRight, topLeft);
  _down.subVectors(bottomMid, topMid);
  if (_right.lengthSq() < 1e-6 || _down.lengthSq() < 1e-6) return null;

  _right.normalize();
  _down.normalize();
  _forward.crossVectors(_right, _down);
  if (_forward.lengthSq() < 1e-6) return null;
  _forward.normalize();

  _up.crossVectors(_forward, _right).normalize();
  if (_up.lengthSq() < 1e-6) {
    _up.copy(_down).negate();
  }

  return {
    forward: _forward.clone(),
    up: _up.clone(),
    right: _right.clone()
  };
}

/**
 * Kalidokit solve + Mesh2Motion-style head directions for swing/twist retargeting.
 */
export function solveFaceRig(faceLandmarks, { video = null, width = 0, height = 0, cal = DEFAULT_CAL } = {}) {
  if (!isFaceHeadUsable(faceLandmarks)) return null;

  const directions = computeFaceHeadDirections(faceLandmarks, cal);
  if (!directions) return null;

  const copy = cloneFaceLandmarks(faceLandmarks);
  const options = { runtime: "mediapipe" };
  if (video) {
    options.video = video;
  } else if (width > 0 && height > 0) {
    options.imageSize = { width, height };
  }

  const rig = Face.solve(copy, options);
  if (!rig?.head) return null;

  const frameWidth = width || video?.videoWidth || 0;
  const proximity = proximityScale(rig.head.width, frameWidth);
  const dampedForward = directions.forward.clone().lerp(new THREE.Vector3(0, 0, -1), 1 - proximity);
  const dampedUp = directions.up.clone().lerp(new THREE.Vector3(0, 1, 0), 1 - proximity);

  const forward = smoothDirection(smoothState.forward, dampedForward);
  const up = smoothDirection(smoothState.up, dampedUp);

  return {
    forward,
    up,
    headRoll: clampValue(rig.head.z * NECK_DAMP * proximity, -NECK_LIMITS.roll, NECK_LIMITS.roll),
    rawHead: rig.head
  };
}
