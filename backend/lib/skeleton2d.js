import { POSE, POSE_BONE_CONNECTIONS, POSE_FOOT_CONNECTIONS } from "../../src/skeletonGraph.js";

const POSE_NAME_BY_INDEX = Object.fromEntries(Object.entries(POSE).map(([name, index]) => [index, name]));

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function landmarkVisible(landmark, min = 0.36) {
  return Boolean(landmark && (landmark.visibility ?? 1) > min);
}

/** Normalized 0–1 canvas coords (letterboxed full frame). */
export function buildSkeleton2d(raw, { width = 1280, height = 720 } = {}) {
  const pose = raw.pose || [];
  const joints = {};

  pose.forEach((landmark, index) => {
    if (!landmark || !landmarkVisible(landmark)) return;
    const name = POSE_NAME_BY_INDEX[index];
    if (!name) return;
    joints[name] = {
      x: round(landmark.x),
      y: round(landmark.y),
      px: round(landmark.x * width),
      py: round(landmark.y * height)
    };
  });

  const segments = [];
  const allConnections = [...POSE_BONE_CONNECTIONS, ...POSE_FOOT_CONNECTIONS];

  allConnections.forEach(([fromIndex, toIndex]) => {
    const from = pose[fromIndex];
    const to = pose[toIndex];
    if (!landmarkVisible(from) || !landmarkVisible(to)) return;
    const fromName = POSE_NAME_BY_INDEX[fromIndex];
    const toName = POSE_NAME_BY_INDEX[toIndex];
    if (!fromName || !toName) return;
    segments.push({
      from: fromName,
      to: toName,
      direction: {
        dx: round(to.x - from.x),
        dy: round(to.y - from.y)
      }
    });
  });

  return {
    canvas_size: [width, height],
    joints,
    segments
  };
}
