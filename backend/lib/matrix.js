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

function jointSeries(timeline, name) {
  return timeline.map((frame) => frame.joints?.[name]).filter(Boolean);
}

function oscillationScore(values) {
  if (values.length < 6) return 0;
  let peaks = 0;
  for (let i = 1; i < values.length - 1; i += 1) {
    const prev = values[i - 1];
    const next = values[i + 1];
    if ((values[i] - prev) * (next - values[i]) < 0) peaks += 1;
  }
  const range = Math.max(...values) - Math.min(...values);
  return range > 0.12 ? peaks / Math.max(values.length, 1) : 0;
}

function detectWave(timeline) {
  for (const name of ["leftWrist", "rightWrist"]) {
    const ys = jointSeries(timeline, name).map((joint) => joint.y);
    if (oscillationScore(ys) >= 0.18) return true;
  }
  return false;
}

function detectBow(timeline) {
  const nose = jointSeries(timeline, "nose");
  const hips = jointSeries(timeline, "leftHip");
  if (nose.length < 4 || hips.length < 4) return false;
  const start = nose[0].y - hips[0].y;
  const min = Math.min(...nose.map((joint, index) => joint.y - (hips[index]?.y ?? hips[0].y)));
  return start - min > 0.18;
}

function detectJump(timeline) {
  const ankles = [
    ...jointSeries(timeline, "leftAnkle"),
    ...jointSeries(timeline, "rightAnkle")
  ];
  if (ankles.length < 4) return false;
  const ys = ankles.map((joint) => joint.y);
  return Math.max(...ys) - Math.min(...ys) > 0.22;
}

function detectDance(timeline) {
  const wrists = [
    ...jointSeries(timeline, "leftWrist"),
    ...jointSeries(timeline, "rightWrist")
  ];
  const ankles = [
    ...jointSeries(timeline, "leftAnkle"),
    ...jointSeries(timeline, "rightAnkle")
  ];
  if (wrists.length < 8 || ankles.length < 8) return false;
  const wristMotion = oscillationScore(wrists.map((joint) => joint.x));
  const footMotion = oscillationScore(ankles.map((joint) => joint.y));
  return wristMotion >= 0.12 && footMotion >= 0.08;
}

function detectArmRaise(timeline) {
  for (const side of ["left", "right"]) {
    const wrist = jointSeries(timeline, `${side}Wrist`);
    const shoulder = jointSeries(timeline, `${side}Shoulder`);
    if (wrist.length < 3 || shoulder.length < 3) continue;
    const lift = Math.max(
      ...wrist.map((joint, index) => (shoulder[index]?.y ?? shoulder[0].y) - joint.y)
    );
    if (lift > 0.28) return true;
  }
  return false;
}

/** Score plain-text metadata matches (phrase, term coverage, prefixes). */
export function scoreTextQuery(text, query) {
  const haystack = String(text || "").toLowerCase();
  const q = String(query || "").toLowerCase().trim();
  if (!q || !haystack) return 0;

  let score = 0;
  if (haystack.includes(q)) score += 4;

  const terms = q.split(/\s+/).filter(Boolean);
  const matched = terms.filter((term) => haystack.includes(term)).length;
  score += matched;
  if (terms.length > 1 && matched === terms.length) score += 2;

  terms.forEach((term) => {
    haystack.split(/\s+/).forEach((word) => {
      if (word.startsWith(term) && word.length > term.length) score += 0.35;
    });
  });

  return score / Math.max(terms.length, 1);
}

/** Heuristic motion-shape scoring from normalized matrix timelines. */
export function scoreMotionSemantics(matrix, query) {
  const q = String(query || "").toLowerCase();
  const timeline = matrix?.timeline || [];
  if (!q || !timeline.length) return 0;

  let score = 0;
  if (/\b(wave|waving|hello|goodbye)\b/.test(q) && detectWave(timeline)) score += 2;
  if (/\b(bow|bowing|curtsy|nod)\b/.test(q) && detectBow(timeline)) score += 2;
  if (/\b(jump|hopping|hop|leap)\b/.test(q) && detectJump(timeline)) score += 2;
  if (/\b(dance|dancing|groove|shuffle)\b/.test(q) && detectDance(timeline)) score += 2;
  if (/\b(raise|lift)\s+(?:your\s+)?(?:(?:left|right|both)\s+)?(?:hand|arm)s?\b/.test(q) && detectArmRaise(timeline)) {
    score += 1.5;
  }
  if (/\bpoint(?:ing)?\b/.test(q) && detectArmRaise(timeline)) score += 1;
  return score;
}

/** Combined segment search score from labels, tags, and motion matrix. */
export function scoreSegmentSearch({ segment, tags = [], matrix, query }) {
  const tagText = tags.map((tag) => `${tag.tag_type} ${tag.tag_value}`).join(" ");
  const haystack = [
    segment.word_prompt,
    segment.label,
    segment.motion_type,
    segment.description,
    segment.filename,
    tagText
  ]
    .filter(Boolean)
    .join(" ");

  let score = scoreTextQuery(haystack, query);
  if (matrix) {
    score += scoreTextQuery(`${matrix.word_prompt || ""} ${matrix.label || ""}`, query);
    score += scoreMotionSemantics(matrix, query);
  }
  return score;
}

/** Build a root-relative motion matrix for a segment (joints × frames). */
export function buildMotionMatrix(frames, { segmentId, wordPrompt = null, label = null } = {}) {
  const timeline = [];
  const flat = [];

  frames.forEach((frame) => {
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

/** Back-compat helper used by legacy search paths. */
export function scoreMotionQuery(matrix, query) {
  return scoreTextQuery(`${matrix.word_prompt || ""} ${matrix.label || ""}`, query);
}
