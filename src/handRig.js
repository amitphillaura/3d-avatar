// MediaPipe hand topology (matches Holistic / Hands).
export const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20]
];

export const HAND_WRIST = 0;
export const HAND_INDEX_MCP = 5;
export const HAND_INDEX_TIP = 8;
export const HAND_MIDDLE_MCP = 9;

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
