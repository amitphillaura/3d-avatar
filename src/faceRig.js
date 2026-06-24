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
const SMOOTH_ALPHA = 0.38;

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

function mapFacePoint(landmark, out = _mapped) {
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

/**
 * Face-plane forward/up in Mushy head space.
 */
export function computeFaceHeadDirections(faceLandmarks) {
  const topLeft = mapFacePoint(faceLandmarks[FACE_PLANE.topLeft]);
  const topRight = mapFacePoint(faceLandmarks[FACE_PLANE.topRight]);
  const bottomRight = mapFacePoint(faceLandmarks[FACE_PLANE.bottomRight]);
  const bottomLeft = mapFacePoint(faceLandmarks[FACE_PLANE.bottomLeft]);

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

export function solveFaceRig(faceLandmarks, { width = 0, height = 0 } = {}) {
  if (!isFaceHeadUsable(faceLandmarks)) return null;

  const directions = computeFaceHeadDirections(faceLandmarks);
  if (!directions) return null;

  const leftEye = mapFacePoint(faceLandmarks[FACE_HEAD_LANDMARKS.leftEyeOuter]);
  const rightEye = mapFacePoint(faceLandmarks[FACE_HEAD_LANDMARKS.rightEyeOuter]);
  const headWidth = leftEye.distanceTo(rightEye);
  const frameWidth = width || height || 1280;
  const proximity = proximityScale(headWidth, frameWidth);
  const dampedForward = directions.forward.clone().lerp(new THREE.Vector3(0, 0, -1), 1 - proximity);
  const dampedUp = directions.up.clone().lerp(new THREE.Vector3(0, 1, 0), 1 - proximity);

  return {
    forward: smoothDirection(smoothState.forward, dampedForward),
    up: smoothDirection(smoothState.up, dampedUp)
  };
}
