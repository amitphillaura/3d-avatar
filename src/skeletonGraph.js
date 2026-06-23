/** Shared pose topology for skeleton panes and GLB retargeting. */

export const POSE = {
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

export const POSE_BONE_CONNECTIONS = [
  [POSE.leftShoulder, POSE.rightShoulder],
  [POSE.leftShoulder, POSE.leftElbow],
  [POSE.leftElbow, POSE.leftWrist],
  [POSE.rightShoulder, POSE.rightElbow],
  [POSE.rightElbow, POSE.rightWrist],
  [POSE.leftShoulder, POSE.leftHip],
  [POSE.rightShoulder, POSE.rightHip],
  [POSE.leftHip, POSE.rightHip],
  [POSE.leftHip, POSE.leftKnee],
  [POSE.leftKnee, POSE.leftAnkle],
  [POSE.rightHip, POSE.rightKnee],
  [POSE.rightKnee, POSE.rightAnkle]
];

/** MediaPipe foot triangle per side: ankle ↔ heel ↔ toe. */
export const POSE_FOOT_CONNECTIONS = [
  [POSE.leftAnkle, POSE.leftHeel],
  [POSE.leftHeel, POSE.leftFootIndex],
  [POSE.leftAnkle, POSE.leftFootIndex],
  [POSE.rightAnkle, POSE.rightHeel],
  [POSE.rightHeel, POSE.rightFootIndex],
  [POSE.rightAnkle, POSE.rightFootIndex]
];

export const POSE_FOOT_JOINTS = [
  POSE.leftHeel,
  POSE.leftFootIndex,
  POSE.rightHeel,
  POSE.rightFootIndex
];

export function midpointLandmark(a, b) {
  if (!a || !b) return null;
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: ((a.z || 0) + (b.z || 0)) / 2,
    visibility: Math.min(a.visibility ?? 1, b.visibility ?? 1)
  };
}

export function shoulderMidFromPose(pose) {
  if (!pose?.length) return null;
  return midpointLandmark(pose[POSE.leftShoulder], pose[POSE.rightShoulder]);
}

export function hipMidFromPose(pose) {
  if (!pose?.length) return null;
  return midpointLandmark(pose[POSE.leftHip], pose[POSE.rightHip]);
}

export function footTipFromPose(pose, side = "left") {
  if (!pose?.length) return null;
  const ankle = side === "left" ? pose[POSE.leftAnkle] : pose[POSE.rightAnkle];
  const heel = side === "left" ? pose[POSE.leftHeel] : pose[POSE.rightHeel];
  const toe = side === "left" ? pose[POSE.leftFootIndex] : pose[POSE.rightFootIndex];
  if (heel && toe) return midpointLandmark(heel, toe);
  return toe || heel || ankle || null;
}
