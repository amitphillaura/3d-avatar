import { MushyAvatar } from "./avatar.js";
import { CharacterAvatar, MIXAMO_BONE_MAP } from "./glbAvatar.js";
import { enrichRegistry, loadModelRegistry, modelUrl } from "./modelRegistry.js";

function createBadge(text, tone = "muted") {
  const span = document.createElement("span");
  span.className = `model-badge model-badge--${tone}`;
  span.textContent = text;
  return span;
}

function fillAnimationSelect(select, names, active) {
  select.innerHTML = "";
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

export class ModelGallery {
  constructor({ bodyMount, faceMount, onPrimaryChange }) {
    this.bodyMount = bodyMount;
    this.faceMount = faceMount;
    this.onPrimaryChange = onPrimaryChange;
    this.bodySlots = [];
    this.faceSlots = [];
    this.mushy = null;
    this.primaryId = "mushy";
  }

  async init() {
    const registry = await enrichRegistry(await loadModelRegistry());
    this.renderBody(registry.body || []);
    this.renderFace(registry.face || []);
    this.setPrimary("mushy");
  }

  renderBody(entries) {
    this.bodyMount.innerHTML = "";

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
    this.bodySlots.push({ id: "mushy", kind: "mushy", card: mushyCard, avatar: this.mushy });

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
        card,
        entry,
        avatar: null
      };

      if (entry.available) {
        this.mountGlb(slot);
      }

      this.bodySlots.push(slot);
    });
  }

  renderFace(entries) {
    this.faceMount.innerHTML = "";

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
      const placeholder = document.createElement("div");
      placeholder.className = "model-placeholder";
      placeholder.innerHTML = `<strong>${file || "—"}</strong><span>Add GLB to public/models/</span>`;
      viewport.appendChild(placeholder);
    }

    const meta = document.createElement("p");
    meta.className = "model-meta";
    meta.textContent = available ? "Starting..." : "Waiting for export";

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
    const animSelect = slot.card.querySelector(".model-anim-select");
    mount.innerHTML = "";

    slot.avatar = new CharacterAvatar(mount, meta, {
      id: slot.entry.id,
      url: modelUrl(slot.entry.file),
      boneMap: slot.entry.rig === "mixamo" ? MIXAMO_BONE_MAP : MIXAMO_BONE_MAP,
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
  }

  mountFaceGlb(slot) {
    const mount = slot.card.querySelector(".model-viewport");
    const meta = slot.card.querySelector(".model-meta");
    const animSelect = slot.card.querySelector(".model-anim-select");
    mount.innerHTML = "";

    slot.avatar = new CharacterAvatar(mount, meta, {
      id: slot.entry.id,
      url: modelUrl(slot.entry.file),
      boneMap: [],
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

    meta.textContent = "Static preview (face retargeting soon)";
  }

  setPrimary(id) {
    this.primaryId = id;
    this.bodySlots.forEach(({ card, id: slotId }) => {
      card.classList.toggle("model-card--active", slotId === id);
    });
    const primary = this.getPrimaryAvatar();
    this.onPrimaryChange?.(primary, id);
  }

  getPrimaryAvatar() {
    if (this.primaryId === "mushy") return this.mushy;
    const slot = this.bodySlots.find((entry) => entry.id === this.primaryId);
    return slot?.avatar || this.mushy;
  }

  updatePose(poseLandmarks) {
    if (!poseLandmarks) return;
    this.mushy?.updatePose(poseLandmarks);
    this.bodySlots.forEach((slot) => {
      if (slot.kind === "glb") slot.avatar?.updatePose(poseLandmarks);
    });
  }

  dispose() {
    this.mushy?.dispose?.();
    this.bodySlots.forEach((slot) => slot.avatar?.dispose?.());
    this.faceSlots.forEach((slot) => slot.avatar?.dispose?.());
  }
}
