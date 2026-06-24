import { MushyAvatar } from "./avatar.js";

/** Mounts and drives the hero Mushy rig viewer. */
export class RigHost {
  constructor({ mount, metaElement }) {
    this.mount = mount;
    this.metaElement = metaElement;
    this.avatar = null;
    this.showJointLabels = false;
    this.trackFingers = false;
  }

  init() {
    this.avatar = new MushyAvatar(this.mount, this.metaElement, {
      framedViewport: true,
      showJointLabels: this.showJointLabels
    });
    return this.avatar;
  }

  prepare(options = {}) {
    if (options.showJointLabels !== undefined) {
      this.showJointLabels = Boolean(options.showJointLabels);
    }
    if (options.trackFingers !== undefined) {
      this.trackFingers = Boolean(options.trackFingers);
    }
  }

  updateTracking(results, media = {}) {
    if (!results || !this.avatar) return;
    this.avatar.updateTracking({
      poseLandmarks: results.poseLandmarks,
      faceLandmarks: results.faceLandmarks,
      leftHandLandmarks: results.leftHandLandmarks,
      rightHandLandmarks: results.rightHandLandmarks,
      media
    });
  }

  resetTracking() {
    this.avatar?.clearTracking?.();
  }

  setTrackFingers(value) {
    this.trackFingers = Boolean(value);
    this.avatar?.setTrackFingers?.(this.trackFingers);
  }

  setShowJointLabels(value) {
    this.showJointLabels = Boolean(value);
    this.avatar?.setShowJointLabels?.(this.showJointLabels);
  }

  dispose() {
    this.avatar?.dispose?.();
    this.avatar = null;
  }
}
