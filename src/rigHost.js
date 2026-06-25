import { MushyAvatar } from "./avatar.js";
import { MushyKid } from "./avatarKid.js";
import { MushyPrime } from "./avatarPrime.js";
import { MushyGhost } from "./avatarGhost.js";
import { MushyAstro } from "./avatarAstro.js";
import { MushyDragon } from "./avatarDragon.js";
import { MushyNeon } from "./avatarNeon.js";
import { MushySlime } from "./avatarSlime.js";
import { MushyShade } from "./avatarShade.js";
import { MushyBloom } from "./avatarBloom.js";
import { MushyWurm } from "./avatarWurm.js";
import { MushyCog } from "./avatarCog.js";
import { MushyVoxel } from "./avatarVoxel.js";
import { MushyGem } from "./avatarGem.js";
import { MushyTrail } from "./avatarTrail.js";
import { MushyFuzz } from "./avatarFuzz.js";
import { MushyAqua } from "./avatarAqua.js";
import { MushyEmber } from "./avatarEmber.js";
import { MushyNimbus } from "./avatarNimbus.js";
import { MushyPix } from "./avatarPix.js";
import { MushyJack } from "./avatarJack.js";
import { MushyStar } from "./avatarStar.js";
import { MushyKnight } from "./avatarKnight.js";
import { MushyMushroom } from "./avatarMushroom.js";
import { MushyOcto } from "./avatarOcto.js";
import { MushyBee } from "./avatarBee.js";
import { MushyMagma } from "./avatarMagma.js";
import { MushyTV } from "./avatarTV.js";
import { MushyAngel } from "./avatarAngel.js";
import { MushyPlush } from "./avatarPlush.js";
import { MushyPirate } from "./avatarPirate.js";
import { MushySkeleton } from "./avatarSkeleton.js";

// Selectable rig variants. Each clones the same public API (updateTracking, dispose,
// setShowJointLabels, …) so RigHost can swap one for another without any other changes.
export const RIG_VARIANTS = {
  mushy: { label: "Mushy", AvatarClass: MushyAvatar },
  mushyKid: { label: "MushyKid", AvatarClass: MushyKid },
  mushyPrime: { label: "MushyPrime", AvatarClass: MushyPrime },
  mushyGhost: { label: "MushyGhost", AvatarClass: MushyGhost },
  mushyAstro: { label: "MushyAstro", AvatarClass: MushyAstro },
  mushyDragon: { label: "MushyDragon", AvatarClass: MushyDragon },
  mushyNeon: { label: "MushyNeon", AvatarClass: MushyNeon },
  mushySlime: { label: "MushySlime", AvatarClass: MushySlime },
  mushyShade: { label: "MushyShade", AvatarClass: MushyShade },
  mushyBloom: { label: "MushyBloom", AvatarClass: MushyBloom },
  mushyWurm: { label: "MushyWurm", AvatarClass: MushyWurm },
  mushyCog: { label: "MushyCog", AvatarClass: MushyCog },
  mushyVoxel: { label: "MushyVoxel", AvatarClass: MushyVoxel },
  mushyGem: { label: "MushyGem", AvatarClass: MushyGem },
  mushyTrail: { label: "MushyTrail", AvatarClass: MushyTrail },
  mushyFuzz: { label: "MushyFuzz", AvatarClass: MushyFuzz },
  mushyAqua: { label: "MushyAqua", AvatarClass: MushyAqua },
  mushyEmber: { label: "MushyEmber", AvatarClass: MushyEmber },
  mushyNimbus: { label: "MushyNimbus", AvatarClass: MushyNimbus },
  mushyPix: { label: "MushyPix", AvatarClass: MushyPix },
  mushyJack: { label: "MushyJack", AvatarClass: MushyJack },
  mushyStar: { label: "MushyStar", AvatarClass: MushyStar },
  mushyKnight: { label: "MushyKnight", AvatarClass: MushyKnight },
  mushyMushroom: { label: "MushyMushroom", AvatarClass: MushyMushroom },
  mushyOcto: { label: "MushyOcto", AvatarClass: MushyOcto },
  mushyBee: { label: "MushyBee", AvatarClass: MushyBee },
  mushyMagma: { label: "MushyMagma", AvatarClass: MushyMagma },
  mushyTV: { label: "MushyTV", AvatarClass: MushyTV },
  mushyAngel: { label: "MushyAngel", AvatarClass: MushyAngel },
  mushyPlush: { label: "MushyPlush", AvatarClass: MushyPlush },
  mushyPirate: { label: "MushyPirate", AvatarClass: MushyPirate },
  mushySkeleton: { label: "MushySkeleton", AvatarClass: MushySkeleton }
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

  init() {
    this.avatar = this.createAvatar();
    return this.avatar;
  }

  createAvatar() {
    const { AvatarClass } = RIG_VARIANTS[this.variant];
    const avatar = new AvatarClass(this.mount, this.metaElement, {
      framedViewport: true,
      showJointLabels: this.showJointLabels
    });
    avatar.setZoom?.(this.zoom); // carry the current zoom across variant rebuilds
    return avatar;
  }

  setZoom(value) {
    this.zoom = Number(value) || 1;
    this.avatar?.setZoom?.(this.zoom);
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
