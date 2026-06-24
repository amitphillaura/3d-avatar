/** Shared joint label text + MediaPipe depth facing for 2D skeleton overlays. */

export function formatJointLabel(name) {
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function formatJointLabelWithFacing(name, facing) {
  const base = formatJointLabel(name);
  return facing ? `${base} (${facing})` : base;
}

export function torsoMidZFromPoseLandmarks(pose) {
  if (!pose) return null;
  const indices = [11, 12, 23, 24];
  let sum = 0;
  let count = 0;
  indices.forEach((index) => {
    if (!pose[index]) return;
    sum += pose[index].z || 0;
    count += 1;
  });
  return count ? sum / count : null;
}

/** MediaPipe: smaller z = closer to the camera. */
export function facingFromMediaPipeZ(landmarkZ, torsoZ) {
  if (torsoZ == null || landmarkZ == null) return null;
  const delta = landmarkZ - torsoZ;
  if (Math.abs(delta) < 0.01) return null;
  return landmarkZ < torsoZ ? "F" : "B";
}
