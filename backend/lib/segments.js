import { MAX_EXPORT_FRAMES } from "./processor.js";

export function validateSegmentRange(frameCount, startFrame, endFrame) {
  const maxIndex = Math.max(0, (frameCount || 0) - 1);
  if (!frameCount) {
    return "Video has no processed frames";
  }
  if (!Number.isFinite(startFrame) || !Number.isFinite(endFrame) || endFrame < startFrame) {
    return "Invalid frame range";
  }
  if (startFrame < 0 || endFrame > maxIndex) {
    return `Frame range must be 0–${maxIndex}`;
  }
  if (endFrame - startFrame + 1 > MAX_EXPORT_FRAMES) {
    return `Segment too large (max ${MAX_EXPORT_FRAMES} frames)`;
  }
  return null;
}
