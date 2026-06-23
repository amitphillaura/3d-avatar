// MediaPipe hand topology (matches Holistic / Hands).
export const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20]
];

const FINGER_CHAIN = (side) => [
  { bone: `mixamorig:${side}HandThumb1`, child: `mixamorig:${side}HandThumb2`, from: 1, to: 2 },
  { bone: `mixamorig:${side}HandThumb2`, child: `mixamorig:${side}HandThumb3`, from: 2, to: 3 },
  { bone: `mixamorig:${side}HandThumb3`, child: `mixamorig:${side}HandThumb4`, from: 3, to: 4 },
  { bone: `mixamorig:${side}HandIndex1`, child: `mixamorig:${side}HandIndex2`, from: 5, to: 6 },
  { bone: `mixamorig:${side}HandIndex2`, child: `mixamorig:${side}HandIndex3`, from: 6, to: 7 },
  { bone: `mixamorig:${side}HandIndex3`, child: `mixamorig:${side}HandIndex4`, from: 7, to: 8 },
  { bone: `mixamorig:${side}HandMiddle1`, child: `mixamorig:${side}HandMiddle2`, from: 9, to: 10 },
  { bone: `mixamorig:${side}HandMiddle2`, child: `mixamorig:${side}HandMiddle3`, from: 10, to: 11 },
  { bone: `mixamorig:${side}HandMiddle3`, child: `mixamorig:${side}HandMiddle4`, from: 11, to: 12 },
  { bone: `mixamorig:${side}HandRing1`, child: `mixamorig:${side}HandRing2`, from: 13, to: 14 },
  { bone: `mixamorig:${side}HandRing2`, child: `mixamorig:${side}HandRing3`, from: 14, to: 15 },
  { bone: `mixamorig:${side}HandRing3`, child: `mixamorig:${side}HandRing4`, from: 15, to: 16 },
  { bone: `mixamorig:${side}HandPinky1`, child: `mixamorig:${side}HandPinky2`, from: 17, to: 18 },
  { bone: `mixamorig:${side}HandPinky2`, child: `mixamorig:${side}HandPinky3`, from: 18, to: 19 },
  { bone: `mixamorig:${side}HandPinky3`, child: `mixamorig:${side}HandPinky4`, from: 19, to: 20 }
];

export const MIXAMO_LEFT_HAND_BONES = FINGER_CHAIN("Left");
export const MIXAMO_RIGHT_HAND_BONES = FINGER_CHAIN("Right");

export const HAND_WRIST = 0;
export const HAND_INDEX_MCP = 5;
export const HAND_INDEX_TIP = 8;
export const HAND_MIDDLE_MCP = 9;

export const MIXAMO_WRIST_BONES = [
  {
    side: "left",
    bone: "mixamorig:LeftHand",
    child: "mixamorig:LeftHandIndex1",
    kind: "wrist"
  },
  {
    side: "right",
    bone: "mixamorig:RightHand",
    child: "mixamorig:RightHandIndex1",
    kind: "wrist"
  }
];

export function pickWristAimIndex(getPoint, visible) {
  if (!visible.has(HAND_WRIST)) return HAND_MIDDLE_MCP;
  const wrist = getPoint(HAND_WRIST);
  let best = HAND_MIDDLE_MCP;
  let bestReach = visible.has(HAND_MIDDLE_MCP) ? wrist.distanceTo(getPoint(HAND_MIDDLE_MCP)) : 0;

  if (visible.has(HAND_INDEX_TIP)) {
    const indexReach = wrist.distanceTo(getPoint(HAND_INDEX_TIP));
    if (indexReach > bestReach * 0.72) {
      best = HAND_INDEX_TIP;
      bestReach = indexReach;
    }
  }

  return best;
}

export function resolveFingerSegment(from, to, getPoint, visible) {
  if (visible.has(from) && visible.has(to)) {
    const start = getPoint(from);
    const end = getPoint(to);
    if (start.distanceTo(end) > 0.012) return { from, to };
  }

  if (from === 5 && visible.has(5) && visible.has(8)) {
    const start = getPoint(5);
    const end = getPoint(8);
    if (start.distanceTo(end) > 0.015) return { from: 5, to: 8 };
  }

  if ((from === 6 || from === 7) && visible.has(from) && visible.has(8)) {
    const start = getPoint(from);
    const end = getPoint(8);
    if (start.distanceTo(end) > 0.012) return { from, to: 8 };
  }

  return { from, to };
}

export function handLandmarkCount(landmarks) {
  if (!landmarks?.length) return 0;
  return landmarks.filter(Boolean).length;
}

export function isHandTracked(landmarks, minPoints = 10) {
  return handLandmarkCount(landmarks) >= minPoints;
}
