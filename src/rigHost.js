function variantSpec(label, load, exportName) {
  return {
    label,
    load,
    exportName: exportName ?? label
  };
}

// Selectable rig variants. Each clones the same public API (updateTracking, dispose,
// setShowJointLabels, …) so RigHost can swap one for another without any other changes.
// Variants load on demand via dynamic import() so the initial bundle stays small.
export const RIG_VARIANTS = {
  mushy: variantSpec("Mushy", () => import("./avatar.js"), "MushyAvatar"),
  mushyKid: variantSpec("MushyKid", () => import("./avatarKid.js")),
  mushyPrime: variantSpec("MushyPrime", () => import("./avatarPrime.js")),
  mushyGhost: variantSpec("MushyGhost", () => import("./avatarGhost.js")),
  mushyAstro: variantSpec("MushyAstro", () => import("./avatarAstro.js")),
  mushyDragon: variantSpec("MushyDragon", () => import("./avatarDragon.js")),
  mushyNeon: variantSpec("MushyNeon", () => import("./avatarNeon.js")),
  mushySlime: variantSpec("MushySlime", () => import("./avatarSlime.js")),
  mushyShade: variantSpec("MushyShade", () => import("./avatarShade.js")),
  mushyBloom: variantSpec("MushyBloom", () => import("./avatarBloom.js")),
  mushyWurm: variantSpec("MushyWurm", () => import("./avatarWurm.js")),
  mushyCog: variantSpec("MushyCog", () => import("./avatarCog.js")),
  mushyVoxel: variantSpec("MushyVoxel", () => import("./avatarVoxel.js")),
  mushyGem: variantSpec("MushyGem", () => import("./avatarGem.js")),
  mushyTrail: variantSpec("MushyTrail", () => import("./avatarTrail.js")),
  mushyFuzz: variantSpec("MushyFuzz", () => import("./avatarFuzz.js")),
  mushyAqua: variantSpec("MushyAqua", () => import("./avatarAqua.js")),
  mushyEmber: variantSpec("MushyEmber", () => import("./avatarEmber.js")),
  mushyNimbus: variantSpec("MushyNimbus", () => import("./avatarNimbus.js")),
  mushyPix: variantSpec("MushyPix", () => import("./avatarPix.js")),
  mushyJack: variantSpec("MushyJack", () => import("./avatarJack.js")),
  mushyStar: variantSpec("MushyStar", () => import("./avatarStar.js")),
  mushyKnight: variantSpec("MushyKnight", () => import("./avatarKnight.js")),
  mushyMushroom: variantSpec("MushyMushroom", () => import("./avatarMushroom.js")),
  mushyOcto: variantSpec("MushyOcto", () => import("./avatarOcto.js")),
  mushyBee: variantSpec("MushyBee", () => import("./avatarBee.js")),
  mushyMagma: variantSpec("MushyMagma", () => import("./avatarMagma.js")),
  mushyTV: variantSpec("MushyTV", () => import("./avatarTV.js")),
  mushyAngel: variantSpec("MushyAngel", () => import("./avatarAngel.js")),
  mushyPlush: variantSpec("MushyPlush", () => import("./avatarPlush.js")),
  mushyPirate: variantSpec("MushyPirate", () => import("./avatarPirate.js")),
  mushySkeleton: variantSpec("MushySkeleton", () => import("./avatarSkeleton.js")),
  vrmDefault: variantSpec("VRM Avatar", () => import("./avatarVrm.js"), "VrmAvatar")
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
    this.zoom = 1;
    this.variant = RIG_VARIANTS[variant] ? variant : DEFAULT_RIG_VARIANT;
  }

  async init() {
    this.avatar = await this.createAvatar();
    return this.avatar;
  }

  async createAvatar() {
    const spec = RIG_VARIANTS[this.variant];
    const mod = await spec.load();
    const AvatarClass = mod[spec.exportName];
    if (!AvatarClass) {
      throw new Error(`Rig variant "${this.variant}" is missing export "${spec.exportName}".`);
    }
    const avatar = new AvatarClass(this.mount, this.metaElement, {
      framedViewport: true,
      showJointLabels: this.showJointLabels
    });
    avatar.setZoom?.(this.zoom); // carry the current zoom across variant rebuilds
    avatar.setTrackFingers?.(this.trackFingers);
    return avatar;
  }

  setZoom(value) {
    this.zoom = Number(value) || 1;
    this.avatar?.setZoom?.(this.zoom);
  }

  // Tear down the current avatar and rebuild with the chosen variant on the same mount,
  // carrying over the joint-label state. Returns the new avatar (or the current one if the
  // variant is unknown / unchanged) so callers can refresh window.__avatar.
  async setVariant(variant) {
    if (!RIG_VARIANTS[variant] || variant === this.variant) return this.avatar;
    const loading = variant;
    this.variant = variant;
    this.avatar?.dispose?.();
    this.avatar = null;
    const avatar = await this.createAvatar();
    if (this.variant !== loading) {
      avatar?.dispose?.();
      return this.avatar;
    }
    this.avatar = avatar;
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
