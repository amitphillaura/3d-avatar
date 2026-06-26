/** Pose landmark indices for wrist pairing (MediaPipe pose). */
export const POSE_LEFT_WRIST = 15;
export const POSE_RIGHT_WRIST = 16;

/**
 * Assign each hand stream to anatomical left/right using pose wrist proximity.
 * Same rule as MushyAvatar.updateHands() and getAnatomicalHands() in app.js.
 */
export function assignAnatomicalHands(poseLandmarks, leftHandLandmarks, rightHandLandmarks) {
  let left = leftHandLandmarks ?? null;
  let right = rightHandLandmarks ?? null;
  if (!poseLandmarks?.length) return { left, right };

  const lw = poseLandmarks[POSE_LEFT_WRIST];
  const rw = poseLandmarks[POSE_RIGHT_WRIST];
  if (!lw || !rw || !left?.[0] || !right?.[0]) return { left, right };

  const sq = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
  if (sq(left[0], rw) + sq(right[0], lw) < sq(left[0], lw) + sq(right[0], rw)) {
    return { left: right, right: left };
  }
  return { left, right };
}
