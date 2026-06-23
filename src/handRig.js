// MediaPipe hand topology (matches Holistic / Hands).
export const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20]
];

const FINGER_CHAIN = (prefix) => [
  { bone: `${prefix}Thumb1`, child: `${prefix}Thumb2`, from: 1, to: 2 },
  { bone: `${prefix}Thumb2`, child: `${prefix}Thumb3`, from: 2, to: 3 },
  { bone: `${prefix}Thumb3`, child: `${prefix}Thumb4`, from: 3, to: 4 },
  { bone: `${prefix}Index1`, child: `${prefix}Index2`, from: 5, to: 6 },
  { bone: `${prefix}Index2`, child: `${prefix}Index3`, from: 6, to: 7 },
  { bone: `${prefix}Index3`, child: `${prefix}Index4`, from: 7, to: 8 },
  { bone: `${prefix}Middle1`, child: `${prefix}Middle2`, from: 9, to: 10 },
  { bone: `${prefix}Middle2`, child: `${prefix}Middle3`, from: 10, to: 11 },
  { bone: `${prefix}Middle3`, child: `${prefix}Middle4`, from: 11, to: 12 },
  { bone: `${prefix}Ring1`, child: `${prefix}Ring2`, from: 13, to: 14 },
  { bone: `${prefix}Ring2`, child: `${prefix}Ring3`, from: 14, to: 15 },
  { bone: `${prefix}Ring3`, child: `${prefix}Ring4`, from: 15, to: 16 },
  { bone: `${prefix}Pinky1`, child: `${prefix}Pinky2`, from: 17, to: 18 },
  { bone: `${prefix}Pinky2`, child: `${prefix}Pinky3`, from: 18, to: 19 },
  { bone: `${prefix}Pinky3`, child: `${prefix}Pinky4`, from: 19, to: 20 }
];

export const MIXAMO_LEFT_HAND_BONES = FINGER_CHAIN("mixamorigLeftHand");
export const MIXAMO_RIGHT_HAND_BONES = FINGER_CHAIN("mixamorigRightHand");

export function handLandmarkCount(landmarks) {
  if (!landmarks?.length) return 0;
  return landmarks.filter(Boolean).length;
}

export function isHandTracked(landmarks, minPoints = 10) {
  return handLandmarkCount(landmarks) >= minPoints;
}
