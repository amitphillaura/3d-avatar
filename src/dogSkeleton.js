/**
 * dogSkeleton.js — AP-10K quadruped skeleton topology (17 keypoints).
 *
 * Keypoint indices match the MMPose AP-10K convention:
 *   0=nose, 1=left_eye, 2=right_eye, 3=neck, 4=tail_base,
 *   5=L_shoulder, 6=L_elbow, 7=L_front_paw, 8=R_shoulder, 9=R_elbow, 10=R_front_paw,
 *   11=L_hip, 12=L_knee, 13=L_hind_paw, 14=R_hip, 15=R_knee, 16=R_hind_paw
 */

export const DOG_JOINTS = [
  { index: 0,  name: "nose" },
  { index: 1,  name: "leftEye" },
  { index: 2,  name: "rightEye" },
  { index: 3,  name: "neck" },
  { index: 4,  name: "tailBase" },
  { index: 5,  name: "leftShoulder" },
  { index: 6,  name: "leftElbow" },
  { index: 7,  name: "leftFrontPaw" },
  { index: 8,  name: "rightShoulder" },
  { index: 9,  name: "rightElbow" },
  { index: 10, name: "rightFrontPaw" },
  { index: 11, name: "leftHip" },
  { index: 12, name: "leftKnee" },
  { index: 13, name: "leftHindPaw" },
  { index: 14, name: "rightHip" },
  { index: 15, name: "rightKnee" },
  { index: 16, name: "rightHindPaw" },
];

export const DOG_BONES = [
  [0, 3],   // nose → neck
  [3, 4],   // neck → tail base (spine)
  [3, 5],   // neck → left shoulder
  [5, 6],   // left shoulder → left elbow
  [6, 7],   // left elbow → left front paw
  [3, 8],   // neck → right shoulder
  [8, 9],   // right shoulder → right elbow
  [9, 10],  // right elbow → right front paw
  [4, 11],  // tail base → left hip
  [11, 12], // left hip → left knee
  [12, 13], // left knee → left hind paw
  [4, 14],  // tail base → right hip
  [14, 15], // right hip → right knee
  [15, 16], // right knee → right hind paw
];
