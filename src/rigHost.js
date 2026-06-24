import { MushyAvatar } from "./avatar.js";
import { MushyKid } from "./avatarKid.js";

// Selectable rig variants. Each clones the same public API (updateTracking, dispose,
// setShowJointLabels, …) so RigHost can swap one for another without any other changes.
export const RIG_VARIANTS = {
  mushy: { label: "Mushy", AvatarClass: MushyAvatar },
  mushyKid: { label: "MushyKid", AvatarClass: MushyKid }
};

export const DEFAULT_RIG_VARIANT = "mushy";

/** Mounts and drives the hero rig viewer (Mushy or a character variant). */
export class RigHost {
  constructor({ mount, metaElement, variant = DEFAULT_RIG_VARIANT }) {
    this.mount = mount;
    this.metaElement = metaElement;
    this.avatar = null;
    this.showJointLabels = false;
    this.trackFingers = false;
    this.variant = RIG_VARIANTS[variant] ? variant : DEFAULT_RIG_VARIANT;
  }

  init() {
    this.avatar = this.createAvatar();
    return this.avatar;
  }

  createAvatar() {
    const { AvatarClass } = RIG_VARIANTS[this.variant];
    return new AvatarClass(this.mount, this.metaElement, {
      framedViewport: true,
      showJointLabels: this.showJointLabels
    });
  }

  // Tear down the current avatar and rebuild with the chosen variant on the same mount,
  // carrying over the joint-label state. Returns the new avatar (or the current one if the
  // variant is unknown / unchanged) so callers can refresh window.__avatar.
  setVariant(variant) {
    if (!RIG_VARIANTS[variant] || variant === this.variant) return this.avatar;
    this.variant = variant;
    this.avatar?.dispose?.();
    this.avatar = this.createAvatar();
    this.avatar.setTrackFingers?.(this.trackFingers);
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
