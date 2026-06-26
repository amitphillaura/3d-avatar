import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assignAnatomicalHands } from "../src/handAssignment.js";
import { scoreSegmentSearch, scoreTextQuery } from "../backend/lib/matrix.js";
import { validateSegmentRange } from "../backend/lib/segments.js";
import { validateMotionExport, MAX_REPLAY_FRAMES } from "../src/motionReplay.js";

describe("assignAnatomicalHands", () => {
  const pose = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }));
  pose[15] = { x: 0.3, y: 0.5, z: 0, visibility: 1 };
  pose[16] = { x: 0.7, y: 0.5, z: 0, visibility: 1 };

  it("keeps labels when already anatomically correct", () => {
    const left = [{ x: 0.3, y: 0.5, z: 0 }];
    const right = [{ x: 0.7, y: 0.5, z: 0 }];
    const result = assignAnatomicalHands(pose, left, right);
    assert.equal(result.left, left);
    assert.equal(result.right, right);
  });

  it("swaps mislabeled hands using wrist proximity", () => {
    const left = [{ x: 0.7, y: 0.5, z: 0 }];
    const right = [{ x: 0.3, y: 0.5, z: 0 }];
    const result = assignAnatomicalHands(pose, left, right);
    assert.equal(result.left, right);
    assert.equal(result.right, left);
  });
});

describe("validateSegmentRange", () => {
  it("accepts in-range segments", () => {
    assert.equal(validateSegmentRange(100, 0, 30), null);
    assert.equal(validateSegmentRange(100, 99, 99), null);
  });

  it("rejects out-of-range end frames", () => {
    assert.match(validateSegmentRange(50, 0, 50), /0–49/);
  });

  it("rejects empty videos", () => {
    assert.equal(validateSegmentRange(0, 0, 10), "Video has no processed frames");
  });
});

describe("scoreSegmentSearch", () => {
  it("scores phrase matches higher than unrelated motion", () => {
    const segment = {
      word_prompt: "wave hello with left hand",
      label: "left_wave",
      motion_type: "gesture",
      description: "",
      filename: "clip.mp4"
    };
    const matrix = {
      word_prompt: "wave hello with left hand",
      label: "left_wave",
      timeline: [
        {
          joints: {
            leftWrist: { x: 0, y: 0.1, z: 0 },
            rightWrist: { x: 0, y: 0, z: 0 },
            leftShoulder: { x: 0, y: 0.5, z: 0 },
            rightShoulder: { x: 0, y: 0.5, z: 0 },
            leftHip: { x: 0, y: 1, z: 0 },
            rightHip: { x: 0, y: 1, z: 0 },
            nose: { x: 0, y: 0.4, z: 0 }
          }
        },
        {
          joints: {
            leftWrist: { x: 0, y: 0.4, z: 0 },
            rightWrist: { x: 0, y: 0, z: 0 },
            leftShoulder: { x: 0, y: 0.5, z: 0 },
            rightShoulder: { x: 0, y: 0.5, z: 0 },
            leftHip: { x: 0, y: 1, z: 0 },
            rightHip: { x: 0, y: 1, z: 0 },
            nose: { x: 0, y: 0.4, z: 0 }
          }
        },
        {
          joints: {
            leftWrist: { x: 0, y: 0.1, z: 0 },
            rightWrist: { x: 0, y: 0, z: 0 },
            leftShoulder: { x: 0, y: 0.5, z: 0 },
            rightShoulder: { x: 0, y: 0.5, z: 0 },
            leftHip: { x: 0, y: 1, z: 0 },
            rightHip: { x: 0, y: 1, z: 0 },
            nose: { x: 0, y: 0.4, z: 0 }
          }
        },
        {
          joints: {
            leftWrist: { x: 0, y: 0.35, z: 0 },
            rightWrist: { x: 0, y: 0, z: 0 },
            leftShoulder: { x: 0, y: 0.5, z: 0 },
            rightShoulder: { x: 0, y: 0.5, z: 0 },
            leftHip: { x: 0, y: 1, z: 0 },
            rightHip: { x: 0, y: 1, z: 0 },
            nose: { x: 0, y: 0.4, z: 0 }
          }
        },
        {
          joints: {
            leftWrist: { x: 0, y: 0.12, z: 0 },
            rightWrist: { x: 0, y: 0, z: 0 },
            leftShoulder: { x: 0, y: 0.5, z: 0 },
            rightShoulder: { x: 0, y: 0.5, z: 0 },
            leftHip: { x: 0, y: 1, z: 0 },
            rightHip: { x: 0, y: 1, z: 0 },
            nose: { x: 0, y: 0.4, z: 0 }
          }
        },
        {
          joints: {
            leftWrist: { x: 0, y: 0.38, z: 0 },
            rightWrist: { x: 0, y: 0, z: 0 },
            leftShoulder: { x: 0, y: 0.5, z: 0 },
            rightShoulder: { x: 0, y: 0.5, z: 0 },
            leftHip: { x: 0, y: 1, z: 0 },
            rightHip: { x: 0, y: 1, z: 0 },
            nose: { x: 0, y: 0.4, z: 0 }
          }
        }
      ]
    };

    const waveScore = scoreSegmentSearch({
      segment,
      tags: [{ tag_type: "action", tag_value: "wave" }],
      matrix,
      query: "wave hello"
    });
    const bowScore = scoreSegmentSearch({
      segment: { ...segment, word_prompt: "bow politely", label: "bow" },
      tags: [],
      matrix: { ...matrix, word_prompt: "bow politely", label: "bow", timeline: [] },
      query: "wave hello"
    });

    assert.ok(waveScore > bowScore);
    assert.ok(scoreTextQuery("wave hello left", "wave hello") >= 4);
  });
});

describe("validateMotionExport", () => {
  it("accepts minimal valid export", () => {
    const payload = validateMotionExport({
      fps: 30,
      frames: [{ raw: { pose: [] } }]
    });
    assert.equal(payload.frames.length, 1);
  });

  it("rejects oversized exports", () => {
    assert.throws(
      () => validateMotionExport({ frames: Array.from({ length: MAX_REPLAY_FRAMES + 1 }, () => ({ raw: {} })) }),
      /exceeds/
    );
  });
});
