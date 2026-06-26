import { mapHandLandmark, mapPoseLandmark, POSE_LM } from "../../src/poseSkeleton.js";

const HAND_NAMES = [
  "wrist",
  "thumb_cmc",
  "thumb_mcp",
  "thumb_ip",
  "thumb_tip",
  "index_mcp",
  "index_pip",
  "index_dip",
  "index_tip",
  "middle_mcp",
  "middle_pip",
  "middle_dip",
  "middle_tip",
  "ring_mcp",
  "ring_pip",
  "ring_dip",
  "ring_tip",
  "pinky_mcp",
  "pinky_pip",
  "pinky_dip",
  "pinky_tip"
];

function roundVec(vec) {
  return {
    x: Math.round(vec.x * 10000) / 10000,
    y: Math.round(vec.y * 10000) / 10000,
    z: Math.round(vec.z * 10000) / 10000
  };
}

function mapHandSet(landmarks) {
  if (!landmarks?.length) return null;
  const joints = {};
  landmarks.forEach((landmark, index) => {
    if (!landmark) return;
    const name = HAND_NAMES[index] ?? `p${index}`;
    joints[name] = roundVec(mapHandLandmark(landmark));
  });
  return joints;
}

/** Mushy 3D joint positions — same mapping as the hero rig. */
export function buildRig3d(raw, { variant = "mushy", pipelineVersion = "poseSkeleton@v1" } = {}) {
  const pose = raw.pose || [];
  const joints3d = {};
  const activePoints = [];

  Object.entries(POSE_LM).forEach(([name, index]) => {
    const landmark = pose[index];
    if (!landmark || (landmark.visibility ?? 1) <= 0.36) return;
    joints3d[name] = roundVec(mapPoseLandmark(landmark));
    activePoints.push(name);
  });

  const boneDirections = {};
  const bonePairs = [
    ["leftShoulder", "leftElbow"],
    ["leftElbow", "leftWrist"],
    ["rightShoulder", "rightElbow"],
    ["rightElbow", "rightWrist"],
    ["leftHip", "leftKnee"],
    ["leftKnee", "leftAnkle"],
    ["rightHip", "rightKnee"],
    ["rightKnee", "rightAnkle"]
  ];

  bonePairs.forEach(([from, to]) => {
    if (!joints3d[from] || !joints3d[to]) return;
    boneDirections[`${from}->${to}`] = roundVec({
      x: joints3d[to].x - joints3d[from].x,
      y: joints3d[to].y - joints3d[from].y,
      z: joints3d[to].z - joints3d[from].z
    });
  });

  return {
    variant,
    pipeline_version: pipelineVersion,
    joints_3d: joints3d,
    bone_directions: boneDirections,
    active_points: activePoints,
    left_hand: mapHandSet(raw.left_hand),
    right_hand: mapHandSet(raw.right_hand)
  };
}
