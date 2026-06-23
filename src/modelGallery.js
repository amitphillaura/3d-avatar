import { MushyAvatar } from "./avatar.js";
import { MushyModelAvatar } from "./mushyModelAvatar.js";
import { enrichRegistry, loadModelRegistry, modelUrl, rescanBodyModels } from "./modelRegistry.js";

const PRIMARY_MODEL_STORAGE_KEY = "live-pose-primary-model";

function createBadge(text, tone = "muted") {
  const span = document.createElement("span");
  span.className = `model-badge model-badge--${tone}`;
  span.textContent = text;
  return span;
}

function fillAnimationSelect(select, names, active) {
  select.replaceChildren();
  if (!names.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No clips";
    select.appendChild(option);
    select.disabled = true;
    return;
  }
  names.forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    if (name === active) option.selected = true;
    select.appendChild(option);
  });
  select.disabled = false;
}

function createMissingPlaceholder(file) {
  const placeholder = document.createElement("div");
  placeholder.className = "model-placeholder";

  const filename = document.createElement("strong");
  filename.textContent = file || "—";

  const hint = document.createElement("span");
  hint.textContent = "Add GLB to public/models/";

  placeholder.append(filename, hint);
  return placeholder;
}

export class ModelGallery {
  constructor({
    bodyMount,
    faceMount,
    heroMount,
    riggedModelMeta,
    riggedModelSelect,
    riggedBadge,
    driverName,
    driverMeta,
    driverAnimSelect,
    onPrimaryChange
  }) {
    this.bodyMount = bodyMount;
    this.faceMount = faceMount;
    this.heroMount = heroMount;
    this.riggedModelMeta = riggedModelMeta;
    this.riggedModelSelect = riggedModelSelect;
    this.riggedBadge = riggedBadge;
    this.driverName = driverName;
    this.driverMeta = driverMeta;
    this.driverAnimSelect = driverAnimSelect;
    this.onPrimaryChange = onPrimaryChange;
    this.bodySlots = [];
    this.faceSlots = [];
    this.mushy = null;
    this.heroAvatar = null;
    this.primaryId = "mushy";
    this.trackFingers = false;
    this.visibilityObserver =
      "IntersectionObserver" in window
        ? new IntersectionObserver(
            (entries) => {
              entries.forEach((entry) => {
                const avatar = entry.target.__avatarPreview;
                avatar?.setPaused?.(!entry.isIntersecting);
              });
            },
            { root: null, rootMargin: "180px", threshold: 0.01 }
          )
        : null;
  }

  async init() {
    this.bodySlots = [];
    this.faceSlots = [];
    await rescanBodyModels();
    const registry = await loadModelRegistry();
    const pendingBody = (registry.body || []).map((entry) => ({ ...entry, available: false }));
    const pendingFace = (registry.face || []).map((entry) => ({ ...entry, available: false }));

    this.renderBody(pendingBody);
    this.renderFace(pendingFace);
    this.populateRiggedModelSelect();
    this.bindRiggedModelSelect();

    const savedId = this.readSavedPrimaryId();
    const initialId = this.bodySlots.some((slot) => slot.id === savedId) ? savedId : "mushy";
    this.setPrimary(initialId);
    this.refreshAvailability(registry);
  }

  async refreshAvailability(registry) {
    try {
      const enriched = await enrichRegistry(registry);

      enriched.body?.forEach((entry) => {
        const slot = this.bodySlots.find((item) => item.id === entry.id);
        if (!slot) return;

        slot.entry = entry;
        const badge = slot.card.querySelector(".model-badge");
        const meta = slot.card.querySelector(".model-meta");
        const viewport = slot.card.querySelector(".model-viewport");

        if (entry.available) {
          slot.card.classList.remove("model-card--missing");
          if (badge) {
            badge.textContent = "Ready";
            badge.className = "model-badge model-badge--ready";
          }
          if (meta) meta.textContent = slot.avatar ? meta.textContent : "Starting...";
          if (!slot.avatar) this.mountGlb(slot);
        } else {
          slot.card.classList.add("model-card--missing");
          if (badge) {
            badge.textContent = "Awaiting file";
            badge.className = "model-badge model-badge--missing";
          }
          if (meta) meta.textContent = "Waiting for export";
          if (viewport && !viewport.querySelector(".model-placeholder")) {
            viewport.replaceChildren(createMissingPlaceholder(entry.file));
          }
        }
      });

      enriched.face?.forEach((entry) => {
        const slot = this.faceSlots.find((item) => item.id === entry.id);
        if (!slot) return;
        slot.entry = entry;
        if (entry.available && !slot.avatar) this.mountFaceGlb(slot);
      });

      this.populateRiggedModelSelect();
      this.updateRiggedBadge(this.getPrimarySlot());
      if (this.primaryId !== "mushy") {
        const primary = this.getPrimarySlot();
        if (primary?.entry?.available && !this.heroAvatar) {
          this.setPrimary(this.primaryId);
        }
      }
    } catch (error) {
      console.error("Model availability check failed:", error);
    }
  }

  readSavedPrimaryId() {
    try {
      return localStorage.getItem(PRIMARY_MODEL_STORAGE_KEY) || "mushy";
    } catch {
      return "mushy";
    }
  }

  savePrimaryId(id) {
    try {
      localStorage.setItem(PRIMARY_MODEL_STORAGE_KEY, id);
    } catch {
      // Ignore storage failures in private mode or restricted embeds.
    }
  }

  isSlotAvailable(slot) {
    if (!slot) return false;
    if (slot.kind === "mushy") return true;
    return Boolean(slot.entry?.available);
  }

  populateRiggedModelSelect() {
    const select = this.riggedModelSelect;
    if (!select) return;

    select.replaceChildren();
    this.bodySlots.forEach((slot) => {
      const option = document.createElement("option");
      option.value = slot.id;
      option.textContent = this.isSlotAvailable(slot)
        ? slot.name
        : `${slot.name} · awaiting file`;
      select.appendChild(option);
    });
    select.value = this.primaryId;
  }

  bindRiggedModelSelect() {
    const select = this.riggedModelSelect;
    if (!select || this._riggedSelectHandler) return;

    this._riggedSelectHandler = (event) => {
      this.setPrimary(event.target.value);
    };
    select.addEventListener("change", this._riggedSelectHandler);
  }

  syncRiggedModelSelect(id) {
    if (this.riggedModelSelect && this.riggedModelSelect.value !== id) {
      this.riggedModelSelect.value = id;
    }
  }

  updateRiggedBadge(slot) {
    if (!this.riggedBadge) return;

    const available = this.isSlotAvailable(slot);
    this.riggedBadge.textContent = available ? "Ready" : "Awaiting file";
    this.riggedBadge.classList.toggle("tile-badge--ready", available);
    this.riggedBadge.classList.toggle("tile-badge--waiting", !available);
  }

  renderBody(entries) {
    this.bodyMount.replaceChildren();

    const mushyCard = this.createCard({
      id: "mushy",
      name: "Mushy Rig",
      kind: "procedural",
      notes: "Built-in procedural body rig.",
      available: true
    });
    this.bodyMount.appendChild(mushyCard);

    const mount = mushyCard.querySelector(".model-viewport");
    const meta = mushyCard.querySelector(".model-meta");
    this.mushy = new MushyAvatar(mount, meta);
    const mushySlot = {
      id: "mushy",
      kind: "mushy",
      name: "Mushy Rig",
      notes: "Built-in procedural body rig.",
      card: mushyCard,
      avatar: this.mushy,
      animSelect: mushyCard.querySelector(".model-anim-select")
    };
    this.bodySlots.push(mushySlot);
    this.observeSlot(mushySlot);

    entries.forEach((entry) => {
      const card = this.createCard({
        id: entry.id,
        name: entry.name,
        kind: "glb",
        notes: entry.notes,
        file: entry.file,
        available: entry.available
      });
      this.bodyMount.appendChild(card);

      const slot = {
        id: entry.id,
        kind: "glb",
        name: entry.name,
        notes: entry.notes,
        file: entry.file,
        card,
        entry,
        avatar: null,
        animSelect: card.querySelector(".model-anim-select")
      };

      if (entry.available) {
        this.mountGlb(slot);
      }

      this.bodySlots.push(slot);
    });
  }

  renderFace(entries) {
    this.faceMount.replaceChildren();

    entries.forEach((entry) => {
      const card = this.createCard({
        id: entry.id,
        name: entry.name,
        kind: "face",
        notes: entry.notes,
        file: entry.file,
        available: entry.available
      });
      this.faceMount.appendChild(card);

      const slot = { id: entry.id, card, entry, avatar: null };
      if (entry.available) {
        this.mountFaceGlb(slot);
      }
      this.faceSlots.push(slot);
    });

    if (!entries.length) {
      const empty = document.createElement("p");
      empty.className = "model-gallery-empty";
      empty.textContent = "Add face models to registry.json and public/models/face/.";
      this.faceMount.appendChild(empty);
    }
  }

  createCard({ id, name, kind, notes, file, available }) {
    const card = document.createElement("article");
    card.className = "model-card";
    card.dataset.modelId = id;
    card.dataset.kind = kind;
    if (!available) card.classList.add("model-card--missing");

    const header = document.createElement("header");
    header.className = "model-card-header";
    const title = document.createElement("h4");
    title.textContent = name;
    header.append(title);
    header.append(
      createBadge(available ? "Ready" : "Awaiting file", available ? "ready" : "missing")
    );

    const viewport = document.createElement("div");
    viewport.className = "model-viewport";
    if (!available) {
      viewport.appendChild(createMissingPlaceholder(file));
    }

    const meta = document.createElement("p");
    meta.className = "model-meta";
    meta.textContent = available ? "Starting..." : "Checking file...";

    const animField = document.createElement("label");
    animField.className = "model-anim-field";
    const animLabel = document.createElement("span");
    animLabel.textContent = "Animation";
    const animSelect = document.createElement("select");
    animSelect.className = "model-anim-select";
    animSelect.disabled = true;
    fillAnimationSelect(animSelect, [], null);
    animField.append(animLabel, animSelect);

    const hint = document.createElement("p");
    hint.className = "model-hint";
    hint.textContent = notes || "";

    const footer = document.createElement("footer");
    footer.className = "model-card-footer";
    footer.append(meta, animField, hint);

    card.append(header, viewport, footer);

    card.addEventListener("click", () => this.setPrimary(id));

    return card;
  }

  mountGlb(slot) {
    const mount = slot.card.querySelector(".model-viewport");
    const meta = slot.card.querySelector(".model-meta");
    const animSelect = slot.animSelect;
    mount.replaceChildren();

    slot.avatar = new MushyModelAvatar(mount, meta, {
      id: slot.entry.id,
      url: modelUrl(slot.entry.file),
      rig: slot.entry.rig,
      trackFingers: this.trackFingers,
      defaultAnimation: slot.entry.defaultAnimation || "idle",
      onAnimationsLoaded: (names, active) => {
        fillAnimationSelect(animSelect, names, active);
        if (this.primaryId === slot.id) {
          this.syncDriverAnimSelect(names, active);
        }
      }
    });

    animSelect.addEventListener("click", (event) => event.stopPropagation());
    animSelect.addEventListener("change", (event) => {
      event.stopPropagation();
      slot.avatar?.setAnimation(animSelect.value);
      if (this.primaryId === slot.id) {
        this.heroAvatar?.setAnimation?.(animSelect.value);
        fillAnimationSelect(this.driverAnimSelect, slot.avatar?.animationNames || [], animSelect.value);
      }
    });
    this.observeSlot(slot);
  }

  mountFaceGlb(slot) {
    const mount = slot.card.querySelector(".model-viewport");
    const meta = slot.card.querySelector(".model-meta");
    const animSelect = slot.card.querySelector(".model-anim-select");
    mount.replaceChildren();

    slot.avatar = new MushyModelAvatar(mount, meta, {
      url: modelUrl(slot.entry.file),
      previewOnly: true,
      rig: slot.entry.rig || "none",
      defaultAnimation: slot.entry.defaultAnimation || "idle",
      onAnimationsLoaded: (names, active) => {
        fillAnimationSelect(animSelect, names, active);
      }
    });

    animSelect.addEventListener("click", (event) => event.stopPropagation());
    animSelect.addEventListener("change", (event) => {
      event.stopPropagation();
      slot.avatar?.setAnimation(animSelect.value);
    });

    meta.textContent = "Static preview · Mushy-driven body when used as hero";
    this.observeSlot(slot);
  }

  observeSlot(slot) {
    if (!slot?.card || !slot?.avatar || !this.visibilityObserver) return;
    slot.card.__avatarPreview = slot.avatar;
    this.visibilityObserver.observe(slot.card);
  }

  disposeHeroAvatar() {
    this.heroAvatar?.dispose?.();
    this.heroAvatar = null;
    this.heroMount?.replaceChildren();
  }

  mountHeroAvatar(slot) {
    this.disposeHeroAvatar();
    if (!this.heroMount) return;

    const meta = this.riggedModelMeta || { textContent: "" };

    if (slot.kind === "mushy") {
      this.heroAvatar = new MushyAvatar(this.heroMount, meta, { framedViewport: true });
      fillAnimationSelect(this.driverAnimSelect, [], null);
      return;
    }

    if (slot.kind === "glb" && slot.entry?.available) {
      this.heroAvatar = new MushyModelAvatar(this.heroMount, meta, {
        framedViewport: true,
        url: modelUrl(slot.entry.file),
        rig: slot.entry.rig,
        trackFingers: this.trackFingers,
        defaultAnimation: slot.entry.defaultAnimation || "idle",
        onAnimationsLoaded: (names, active) => {
          this.syncDriverAnimSelect(names, active);
          if (slot.animSelect) fillAnimationSelect(slot.animSelect, names, active);
        }
      });
    } else if (slot.kind === "glb") {
      this.heroMount.innerHTML =
        '<div class="model-placeholder"><strong>Awaiting file</strong><span>Add GLB to public/models/</span></div>';
    }

    requestAnimationFrame(() => this.heroAvatar?.resize?.());
  }

  syncDriverAnimSelect(names, active) {
    if (!this.driverAnimSelect) return;
    fillAnimationSelect(this.driverAnimSelect, names, active);
    if (!this._driverAnimHandler) {
      this._driverAnimHandler = (event) => {
        const clip = event.target.value;
        this.heroAvatar?.setAnimation?.(clip);
        const slot = this.bodySlots.find((entry) => entry.id === this.primaryId);
        slot?.avatar?.setAnimation?.(clip);
        if (slot?.animSelect) slot.animSelect.value = clip;
      };
      this.driverAnimSelect.addEventListener("change", this._driverAnimHandler);
    }
  }

  updateDriverPanel(slot) {
    if (this.driverName) this.driverName.textContent = slot?.name || "Mushy Rig";
    if (this.driverMeta) {
      this.driverMeta.textContent =
        slot?.notes || slot?.entry?.notes || "Built-in procedural body rig.";
    }
    if (this.riggedModelMeta) {
      this.riggedModelMeta.textContent = `${slot?.name || "Mushy Rig"} · waiting for pose`;
    }
  }

  setPrimary(id) {
    const slot = this.bodySlots.find((entry) => entry.id === id) || this.bodySlots[0];
    this.primaryId = slot.id;
    this.savePrimaryId(slot.id);

    this.bodySlots.forEach(({ card, id: slotId }) => {
      card.classList.toggle("model-card--active", slotId === slot.id);
    });

    this.syncRiggedModelSelect(slot.id);
    this.updateRiggedBadge(slot);
    this.updateDriverPanel(slot);
    this.mountHeroAvatar(slot);

    const primary = this.getPrimaryAvatar();
    this.onPrimaryChange?.(primary, slot.id);
  }

  getPrimaryAvatar() {
    if (this.heroAvatar) return this.heroAvatar;
    if (this.primaryId === "mushy") return this.mushy;
    const slot = this.bodySlots.find((entry) => entry.id === this.primaryId);
    return slot?.avatar || this.mushy;
  }

  getPrimarySlot() {
    return this.bodySlots.find((entry) => entry.id === this.primaryId);
  }

  updateTracking(results, media = {}) {
    if (!results) return;
    const payload = {
      poseLandmarks: results.poseLandmarks,
      faceLandmarks: results.faceLandmarks,
      leftHandLandmarks: results.leftHandLandmarks,
      rightHandLandmarks: results.rightHandLandmarks,
      media
    };
    const apply = (avatar) => {
      if (!avatar) return;
      if (avatar.updateTracking) avatar.updateTracking(payload);
      else avatar.updatePose?.(payload.poseLandmarks);
    };

    apply(this.heroAvatar);

    this.bodySlots.forEach((slot) => {
      if (slot.id === this.primaryId && this.heroAvatar) return;
      if (slot.kind === "mushy") apply(this.mushy);
      else if (slot.kind === "glb") apply(slot.avatar);
    });
  }

  updatePose(poseLandmarks) {
    this.updateTracking({
      poseLandmarks,
      faceLandmarks: null,
      leftHandLandmarks: null,
      rightHandLandmarks: null
    });
  }

  // Force every avatar back to idle/bind (source switch, stop, reset) — as opposed to a
  // paused video, where avatars HOLD their last pose.
  resetTracking() {
    this.heroAvatar?.clearTracking?.();
    this.mushy?.clearTracking?.();
    this.bodySlots.forEach((slot) => slot.avatar?.clearTracking?.());
  }

  setTrackFingers(value) {
    this.trackFingers = Boolean(value);
    this.heroAvatar?.setTrackFingers?.(this.trackFingers);
    this.bodySlots.forEach((slot) => slot.avatar?.setTrackFingers?.(this.trackFingers));
  }

  dispose() {
    this.visibilityObserver?.disconnect();
    this.disposeHeroAvatar();
    this.mushy?.dispose?.();
    this.bodySlots.forEach((slot) => slot.avatar?.dispose?.());
    this.faceSlots.forEach((slot) => slot.avatar?.dispose?.());
    this.bodySlots = [];
    this.faceSlots = [];
    this.mushy = null;
  }
}
