import * as THREE from "three";

/** MediaPipe pose indices — same graph Mushy draws in 3D. */
export const POSE_LM = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftHeel: 29,
  rightHeel: 30,
  leftFootIndex: 31,
  rightFootIndex: 32
};

export const POSE_LM_NAMES = Object.keys(POSE_LM);

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _tip = new THREE.Vector3();

/** Typical foot Y in Mushy space when the subject is centered in frame. */
export const MUSHY_FOOT_Y = (0.58 - 0.9) * 4.8;

/** Typical hip-line Y for Mushy hero framing. */
export const MUSHY_HIP_Y = (0.58 - 0.62) * 4.8;

/** Proven Mushy 3D mapping — rigged models use this, not a separate CAL. */
export function mapPoseLandmark(landmark, out = new THREE.Vector3()) {
  return out.set(
    (0.5 - landmark.x) * 4.3,
    (0.58 - landmark.y) * 4.8,
    -0.65 - (landmark.z || 0) * 1.4
  );
}

export function mapHandLandmark(landmark, out = new THREE.Vector3()) {
  return out.set(
    (0.5 - landmark.x) * 4.3,
    (0.58 - landmark.y) * 4.8,
    -0.65 - (landmark.z || 0) * 1.4 * 2.6
  );
}

export function writeFootTip(get, has, side, out) {
  const heel = side === "left" ? "leftHeel" : "rightHeel";
  const toe = side === "left" ? "leftFootIndex" : "rightFootIndex";
  if (has(heel) && has(toe)) {
    return out.addVectors(get(heel), get(toe)).multiplyScalar(0.5);
  }
  if (has(toe)) return out.copy(get(toe));
  if (has(heel)) return out.copy(get(heel));
  return null;
}

/** Segment direction in skeleton space — same vectors Mushy cylinders use. */
export function writeSegmentDirection(
  get,
  has,
  from,
  to,
  out,
  { footSide = null, swap = (n) => n } = {}
) {
  const startName = swap(from);
  if (!has(startName)) return null;

  if (footSide) {
    if (!writeFootTip(get, has, footSide, _tip)) return null;
    out.subVectors(_tip, get(startName));
  } else {
    const endName = swap(to);
    if (!has(endName)) return null;
    out.subVectors(get(endName), get(startName));
  }

  if (out.lengthSq() < 1e-6) return null;
  return out.normalize();
}

/** Shoulder-mid → nose, matching Mushy neck cylinder. */
export function writeNeckDirection(get, has, out) {
  if (!has("nose")) return null;

  if (has("leftShoulder") && has("rightShoulder")) {
    _a.addVectors(get("leftShoulder"), get("rightShoulder")).multiplyScalar(0.5);
  } else {
    _a.set(0, get("nose").y - 0.22, get("nose").z * 0.5);
  }

  _b.copy(get("nose"));
  _b.y += 0.12;
  out.subVectors(_b, _a);
  if (out.lengthSq() < 1e-6) return null;
  return out.normalize();
}

/** Hip-mid → shoulder-mid (torso up). */
export function writeTorsoDirection(get, has, out) {
  if (
    !has("leftShoulder") ||
    !has("rightShoulder") ||
    !has("leftHip") ||
    !has("rightHip")
  ) {
    return null;
  }

  _a.addVectors(get("leftShoulder"), get("rightShoulder")).multiplyScalar(0.5);
  _b.addVectors(get("leftHip"), get("rightHip")).multiplyScalar(0.5);
  out.subVectors(_a, _b);
  if (out.lengthSq() < 1e-6) return null;
  return out.normalize();
}

export function hipLineYaw(get, has) {
  if (!has("leftHip") || !has("rightHip")) return 0;
  _a.subVectors(get("rightHip"), get("leftHip"));
  return Math.atan2(_a.z, _a.x);
}

export function shoulderTwistYaw(get, has) {
  if (!has("leftShoulder") || !has("rightShoulder")) return 0;
  _a.subVectors(get("rightShoulder"), get("leftShoulder"));
  return Math.atan2(_a.z, _a.x) - hipLineYaw(get, has);
}
