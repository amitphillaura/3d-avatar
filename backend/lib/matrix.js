import { POSE_LM } from "../../src/poseSkeleton.js";

const CORE_JOINTS = [
  "nose",
  "leftShoulder",
  "rightShoulder",
  "leftElbow",
  "rightElbow",
  "leftWrist",
  "rightWrist",
  "leftHip",
  "rightHip",
  "leftKnee",
  "rightKnee",
  "leftAnkle",
  "rightAnkle"
];

function midpoint(a, b) {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: (a.z + b.z) / 2
  };
}

function normalizeFrame(joints3d) {
  const leftHip = joints3d.leftHip;
  const rightHip = joints3d.rightHip;
  const leftShoulder = joints3d.leftShoulder;
  const rightShoulder = joints3d.rightShoulder;
  if (!leftHip || !rightHip || !leftShoulder || !rightShoulder) return null;

  const root = midpoint(leftHip, rightHip);
  const shoulderMid = midpoint(leftShoulder, rightShoulder);
  const scale = Math.max(
    Math.hypot(leftShoulder.x - rightShoulder.x, leftShoulder.y - rightShoulder.y, leftShoulder.z - rightShoulder.z),
    0.55
  );

  const normalized = {};
  CORE_JOINTS.forEach((name) => {
    const joint = joints3d[name];
    if (!joint) {
      normalized[name] = null;
      return;
    }
    normalized[name] = {
      x: (joint.x - root.x) / scale,
      y: (joint.y - root.y) / scale,
      z: (joint.z - root.z) / scale
    };
  });

  return {
    root,
    shoulder_mid: shoulderMid,
    scale,
    joints: normalized
  };
}

/** Build a root-relative motion matrix for a segment (joints × frames). */
export function buildMotionMatrix(frames, { segmentId, wordPrompt = null, label = null } = {}) {
  const timeline = [];
  const flat = [];

  frames.forEach((frame, offset) => {
    const joints3d = frame.rig?.joints_3d || {};
    const normalized = normalizeFrame(joints3d);
    if (!normalized) return;
    timeline.push({
      frame_index: frame.frame_index,
      timestamp_ms: frame.timestamp_ms,
      joints: normalized.joints
    });
    CORE_JOINTS.forEach((name) => {
      const joint = normalized.joints[name];
      if (!joint) {
        flat.push(0, 0, 0);
        return;
      }
      flat.push(joint.x, joint.y, joint.z);
    });
  });

  const magnitude = Math.hypot(...flat) || 1;
  const embedding = flat.map((value) => Math.round((value / magnitude) * 10000) / 10000);

  return {
    segment_id: segmentId,
    label,
    word_prompt: wordPrompt,
    pipeline_version: frames[0]?.rig?.pipeline_version || "poseSkeleton@v1",
    joint_order: CORE_JOINTS,
    frame_count: timeline.length,
    timeline,
    vector: embedding,
    vector_dim: embedding.length
  };
}

export function scoreMotionQuery(matrix, query) {
  const terms = String(query || "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!terms.length) return 0;

  const haystack = `${matrix.word_prompt || ""} ${matrix.label || ""}`.toLowerCase();
  let score = 0;
  terms.forEach((term) => {
    if (haystack.includes(term)) score += 1;
  });
  return score / terms.length;
}
