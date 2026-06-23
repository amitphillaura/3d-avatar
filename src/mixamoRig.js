export function resolveMixamoBone(root, name) {
  if (!root || !name) return null;
  let bone = root.getObjectByName(name);
  if (bone) return bone;

  const alt = name.includes(":")
    ? name.replace("mixamorig:", "mixamorig")
    : name.replace(/^mixamorig(?=[A-Z])/, "mixamorig:");
  return root.getObjectByName(alt) || null;
}

export function resolveModelBone(root, name) {
  if (!root || !name) return null;
  return root.getObjectByName(name) || resolveMixamoBone(root, name);
}

export function findSpineBone(model) {
  return (
    resolveModelBone(model, "Spine02") ||
    resolveModelBone(model, "Spine01") ||
    resolveModelBone(model, "Spine") ||
    resolveModelBone(model, "mixamorigSpine")
  );
}

export function findNeckBone(model) {
  return (
    resolveModelBone(model, "neck_01") ||
    resolveModelBone(model, "Neck") ||
    resolveModelBone(model, "neck") ||
    resolveModelBone(model, "mixamorigNeck")
  );
}

export function findHeadBone(model) {
  return (
    resolveModelBone(model, "Head") ||
    resolveModelBone(model, "head") ||
    resolveModelBone(model, "mixamorigHead")
  );
}

export function findHipsBone(model) {
  return (
    resolveModelBone(model, "mixamorigHips") ||
    resolveModelBone(model, "Hips") ||
    resolveModelBone(model, "pelvis") ||
    resolveModelBone(model, "hip")
  );
}

export function getBoneMapForRig(rig) {
  if (rig === "meshy") return MESHY_BONE_MAP;
  return MIXAMO_BONE_MAP;
}

export const MIXAMO_BONE_MAP = [
  {
    bone: "mixamorigLeftArm",
    child: "mixamorigLeftForeArm",
    from: "leftShoulder",
    to: "leftElbow",
    limb: "arm"
  },
  {
    bone: "mixamorigLeftForeArm",
    child: "mixamorigLeftHand",
    from: "leftElbow",
    to: "leftWrist",
    limb: "arm"
  },
  {
    bone: "mixamorigRightArm",
    child: "mixamorigRightForeArm",
    from: "rightShoulder",
    to: "rightElbow",
    limb: "arm"
  },
  {
    bone: "mixamorigRightForeArm",
    child: "mixamorigRightHand",
    from: "rightElbow",
    to: "rightWrist",
    limb: "arm"
  },
  {
    bone: "mixamorigLeftUpLeg",
    child: "mixamorigLeftLeg",
    from: "leftHip",
    to: "leftKnee",
    limb: "leg",
    joint: "hip"
  },
  {
    bone: "mixamorigLeftLeg",
    child: "mixamorigLeftFoot",
    from: "leftKnee",
    to: "leftAnkle",
    limb: "leg",
    joint: "knee"
  },
  {
    bone: "mixamorigRightUpLeg",
    child: "mixamorigRightLeg",
    from: "rightHip",
    to: "rightKnee",
    limb: "leg",
    joint: "hip"
  },
  {
    bone: "mixamorigRightLeg",
    child: "mixamorigRightFoot",
    from: "rightKnee",
    to: "rightAnkle",
    limb: "leg",
    joint: "knee"
  },
  {
    bone: "mixamorigLeftFoot",
    child: "mixamorigLeftToeBase",
    from: "leftAnkle",
    to: "leftFootIndex",
    limb: "foot"
  },
  {
    bone: "mixamorigRightFoot",
    child: "mixamorigRightToeBase",
    from: "rightAnkle",
    to: "rightFootIndex",
    limb: "foot"
  }
];

export const MESHY_BONE_MAP = [
  { bone: "LeftArm", child: "LeftForeArm", from: "leftShoulder", to: "leftElbow", limb: "arm" },
  { bone: "LeftForeArm", child: "LeftHand", from: "leftElbow", to: "leftWrist", limb: "arm" },
  { bone: "RightArm", child: "RightForeArm", from: "rightShoulder", to: "rightElbow", limb: "arm" },
  { bone: "RightForeArm", child: "RightHand", from: "rightElbow", to: "rightWrist", limb: "arm" },
  { bone: "LeftUpLeg", child: "LeftLeg", from: "leftHip", to: "leftKnee", limb: "leg", joint: "hip" },
  { bone: "LeftLeg", child: "LeftFoot", from: "leftKnee", to: "leftAnkle", limb: "leg", joint: "knee" },
  { bone: "RightUpLeg", child: "RightLeg", from: "rightHip", to: "rightKnee", limb: "leg", joint: "hip" },
  { bone: "RightLeg", child: "RightFoot", from: "rightKnee", to: "rightAnkle", limb: "leg", joint: "knee" },
  { bone: "LeftFoot", child: "LeftToeBase", from: "leftAnkle", to: "leftFootIndex", limb: "foot" },
  { bone: "RightFoot", child: "RightToeBase", from: "rightAnkle", to: "rightFootIndex", limb: "foot" }
];

export const MIXAMO_SPINE_BONES = ["mixamorigSpine", "mixamorigNeck", "mixamorigHead", "mixamorigHips"];

export function depthScaleForLimb(limb, handActive = false) {
  if (limb === "foot") return 0.95;
  if (limb === "leg") return 0.9;
  if (handActive) return 0.88;
  return 0.55;
}

export function hipJointBlend(name) {
  return name === "leftHip" || name === "rightHip" ? 0.68 : 1;
}
