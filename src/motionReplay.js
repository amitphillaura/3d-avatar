/** Convert a Motion Library processed frame into Holistic-style results. */
export function frameToHolisticResults(frame) {
  const raw = frame?.raw || {};
  return {
    poseLandmarks: raw.pose || null,
    faceLandmarks: raw.face || null,
    leftHandLandmarks: raw.left_hand || null,
    rightHandLandmarks: raw.right_hand || null
  };
}

/** Drive segment playback on the hero rig (and optional 2D panes via callbacks). */
export class MotionReplay {
  constructor({ onFrame, onStateChange } = {}) {
    this.frames = [];
    this.fps = 30;
    this.index = 0;
    this.playing = false;
    this.loop = true;
    this.timer = null;
    this.metadata = null;
    this.onFrame = onFrame;
    this.onStateChange = onStateChange;
  }

  get active() {
    return this.frames.length > 0;
  }

  load(payload) {
    this.stop(false);
    this.frames = payload?.frames || [];
    this.fps = payload?.fps || 30;
    this.metadata = {
      segmentId: payload?.segment?.id || null,
      label:
        payload?.segment?.word_prompt ||
        payload?.segment?.label ||
        payload?.video?.filename ||
        "Motion replay",
      rigVariant: payload?.video?.rig_variant || "mushy",
      width: payload?.video?.width || 1280,
      height: payload?.video?.height || 720
    };
    this.index = 0;
    this._emitState();
    if (this.frames.length) this._emitFrame();
    return this.metadata;
  }

  async loadSegment(segmentId) {
    const response = await fetch(`/api/segments/${segmentId}/export`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || `Could not load segment (${response.status})`);
    }
    return this.load(payload);
  }

  play() {
    if (!this.frames.length || this.playing) return;
    this.playing = true;
    this._emitState();
    this._scheduleTick();
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    this._clearTimer();
    this._emitState();
  }

  stop(clearFrames = true) {
    this.playing = false;
    this._clearTimer();
    if (clearFrames) {
      this.frames = [];
      this.metadata = null;
      this.index = 0;
    }
    this._emitState();
  }

  toggleLoop() {
    this.loop = !this.loop;
    this._emitState();
    return this.loop;
  }

  seek(index) {
    if (!this.frames.length) return;
    this.index = Math.max(0, Math.min(this.frames.length - 1, Number(index) || 0));
    this._emitFrame();
    this._emitState();
  }

  step(delta) {
    this.seek(this.index + delta);
  }

  _scheduleTick() {
    this._clearTimer();
    const intervalMs = 1000 / Math.max(this.fps, 1);
    this.timer = window.setInterval(() => {
      if (this.index >= this.frames.length - 1) {
        if (this.loop) {
          this.index = 0;
          this._emitFrame();
          return;
        }
        this.pause();
        return;
      }
      this.index += 1;
      this._emitFrame();
      this._emitState();
    }, intervalMs);
  }

  _clearTimer() {
    if (this.timer) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  _emitFrame() {
    const frame = this.frames[this.index];
    if (frame && this.onFrame) {
      this.onFrame(frame, this.metadata, this.index, this.frames.length);
    }
  }

  _emitState() {
    this.onStateChange?.({
      active: this.active,
      playing: this.playing,
      loop: this.loop,
      index: this.index,
      frameCount: this.frames.length,
      fps: this.fps,
      label: this.metadata?.label || "",
      rigVariant: this.metadata?.rigVariant || "mushy"
    });
  }
}
