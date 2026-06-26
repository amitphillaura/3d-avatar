const API_BASE = "";

const apiStatusEl = document.getElementById("apiStatus");
const videoListEl = document.getElementById("videoList");
const detailPanelEl = document.getElementById("detailPanel");
const detailTitleEl = document.getElementById("detailTitle");
const detailMetaEl = document.getElementById("detailMeta");
const detailVideoEl = document.getElementById("detailVideo");
const tagListEl = document.getElementById("tagList");
const segmentListEl = document.getElementById("segmentList");
const framePreviewEl = document.getElementById("framePreview");
const searchResultsEl = document.getElementById("searchResults");

let selectedVideoId = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, options);
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : null;
  if (!response.ok) {
    throw new Error(payload?.error || `Request failed (${response.status})`);
  }
  if (response.status === 204) return null;
  return payload;
}

function statusPill(status) {
  const cls =
    status === "ready" ? "motion-pill motion-pill--ok" : status === "failed" ? "motion-pill motion-pill--warn" : "motion-pill";
  return `<span class="${cls}">${escapeHtml(status)}</span>`;
}

function renderVideos(videos) {
  if (!videos.length) {
    videoListEl.innerHTML = `<p class="motion-subtitle">No videos yet. Upload one to start.</p>`;
    return;
  }

  videoListEl.innerHTML = videos
    .map(
      (video) => `
      <div class="motion-item">
        <div class="motion-item-head">
          <div>
            <strong>${escapeHtml(video.filename)}</strong>
            <div class="motion-subtitle">${video.frame_count || 0} frames · ${escapeHtml(video.rig_variant)}</div>
          </div>
          ${statusPill(video.status)}
        </div>
        <div class="motion-item-actions">
          <button type="button" class="btn" data-action="open" data-id="${escapeHtml(video.id)}">Open</button>
          <button type="button" class="btn" data-action="process" data-id="${escapeHtml(video.id)}" ${video.status === "processing" ? "disabled" : ""}>
            ${video.status === "ready" ? "Reprocess" : "Process"}
          </button>
          <button type="button" class="btn btn--ghost" data-action="delete" data-id="${escapeHtml(video.id)}" ${video.status === "processing" ? "disabled" : ""}>
            Delete
          </button>
        </div>
        ${video.error_message ? `<p class="motion-subtitle">${escapeHtml(video.error_message)}</p>` : ""}
      </div>`
    )
    .join("");
}

function renderTags(tags) {
  tagListEl.innerHTML = tags
    .map((tag) => `<li class="motion-pill">${escapeHtml(tag.tag_type)}: ${escapeHtml(tag.tag_value)}</li>`)
    .join("");
}

function renderSegments(segments) {
  if (!segments.length) {
    segmentListEl.innerHTML = `<p class="motion-subtitle">No segments yet.</p>`;
    return;
  }

  segmentListEl.innerHTML = segments
    .map(
      (segment) => `
      <div class="motion-item">
        <div class="motion-item-head">
          <div>
            <strong>${escapeHtml(segment.label || "Untitled segment")}</strong>
            <div class="motion-subtitle">frames ${segment.start_frame}–${segment.end_frame}</div>
            <div class="motion-subtitle">${escapeHtml(segment.word_prompt || "No word prompt")}</div>
          </div>
          <span class="motion-pill">${escapeHtml(segment.matrix_status)}</span>
        </div>
        <div class="motion-item-actions">
          <button type="button" class="btn" data-segment-action="matrix" data-id="${escapeHtml(segment.id)}">Build matrix</button>
          <a class="btn btn--ghost" href="/?replay=${escapeHtml(segment.id)}">Play in Rig</a>
          <button type="button" class="btn btn--ghost" data-segment-action="export" data-id="${escapeHtml(segment.id)}">Export JSON</button>
        </div>
      </div>`
    )
    .join("");
}

async function refreshVideos() {
  const { videos } = await api("/api/videos");
  renderVideos(videos);
  if (selectedVideoId) {
    const current = videos.find((video) => video.id === selectedVideoId);
    if (current?.status === "processing") {
      window.setTimeout(refreshVideos, 2000);
    }
  }
}

async function openVideo(videoId) {
  const detail = await api(`/api/videos/${videoId}`);
  selectedVideoId = videoId;
  detailPanelEl.hidden = false;
  detailTitleEl.textContent = detail.video.filename;
  detailMetaEl.innerHTML = [
    statusPill(detail.video.status),
    `<span class="motion-pill">${escapeHtml(detail.video.rig_variant)}</span>`,
    `<span class="motion-pill">${detail.video.frame_count || 0} frames</span>`,
    `<span class="motion-pill">${escapeHtml(detail.video.tracking_mode)}</span>`
  ].join("");
  detailVideoEl.src = `/api/videos/${videoId}/source`;
  document.getElementById("segmentEnd").value = Math.max(30, (detail.video.frame_count || 30) - 1);
  renderTags(detail.tags);
  renderSegments(detail.segments);
}

async function checkApi() {
  try {
    await api("/api/health");
    apiStatusEl.textContent = "Motion API online";
  } catch (error) {
    apiStatusEl.textContent = `Motion API offline — run npm run backend (${error.message})`;
  }
}

document.getElementById("uploadForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const fileInput = document.getElementById("videoFile");
  const file = fileInput.files?.[0];
  if (!file) return;

  const body = new FormData();
  body.append("file", file);
  body.append("rig_variant", document.getElementById("rigVariant").value);
  body.append("tracking_mode", document.getElementById("trackingMode").value);

  try {
    const result = await api("/api/videos", { method: "POST", body });
    fileInput.value = "";
    await refreshVideos();
    await openVideo(result.video_id);
  } catch (error) {
    window.alert(error.message);
  }
});

document.getElementById("refreshVideos").addEventListener("click", () => {
  refreshVideos().catch((error) => window.alert(error.message));
});

videoListEl.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const videoId = button.dataset.id;
  try {
    if (button.dataset.action === "open") {
      await openVideo(videoId);
      return;
    }
    if (button.dataset.action === "process") {
      await api(`/api/videos/${videoId}/process`, { method: "POST" });
      await refreshVideos();
      if (selectedVideoId === videoId) await openVideo(videoId);
      return;
    }
    if (button.dataset.action === "delete") {
      if (!window.confirm("Delete this video and all segments?")) return;
      await api(`/api/videos/${videoId}`, { method: "DELETE" });
      if (selectedVideoId === videoId) {
        detailPanelEl.hidden = true;
        selectedVideoId = null;
      }
      await refreshVideos();
    }
  } catch (error) {
    window.alert(error.message);
  }
});

document.getElementById("closeDetail").addEventListener("click", () => {
  detailPanelEl.hidden = true;
  selectedVideoId = null;
});

document.getElementById("tagForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!selectedVideoId) return;
  try {
    await api(`/api/videos/${selectedVideoId}/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tag_type: document.getElementById("tagType").value,
        tag_value: document.getElementById("tagValue").value
      })
    });
    await openVideo(selectedVideoId);
  } catch (error) {
    window.alert(error.message);
  }
});

document.getElementById("segmentForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!selectedVideoId) return;
  try {
    await api(`/api/videos/${selectedVideoId}/segments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        start_frame: Number(document.getElementById("segmentStart").value),
        end_frame: Number(document.getElementById("segmentEnd").value),
        label: document.getElementById("segmentLabel").value,
        motion_type: document.getElementById("segmentMotionType").value,
        word_prompt: document.getElementById("segmentWordPrompt").value
      })
    });
    await openVideo(selectedVideoId);
  } catch (error) {
    window.alert(error.message);
  }
});

segmentListEl.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-segment-action]");
  if (!button) return;
  const segmentId = button.dataset.id;
  try {
    if (button.dataset.segmentAction === "matrix") {
      await api(`/api/segments/${segmentId}/build-matrix`, { method: "POST" });
      await openVideo(selectedVideoId);
      return;
    }
    if (button.dataset.segmentAction === "export") {
      const payload = await api(`/api/segments/${segmentId}/export`);
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${segmentId}.json`;
      link.click();
      URL.revokeObjectURL(url);
    }
  } catch (error) {
    window.alert(error.message);
  }
});

document.getElementById("frameForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!selectedVideoId) return;
  const frameIndex = Number(document.getElementById("frameIndex").value);
  try {
    const payload = await api(`/api/videos/${selectedVideoId}/frames/${frameIndex}`);
    framePreviewEl.textContent = JSON.stringify(payload.frame, null, 2);
  } catch (error) {
    window.alert(error.message);
  }
});

document.getElementById("searchForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const q = document.getElementById("searchQuery").value.trim();
  try {
    const { results } = await api(`/api/search/motion?q=${encodeURIComponent(q)}`);
    searchResultsEl.innerHTML = results.length
      ? results
          .map(
            ({ segment, score }) => `
            <div class="motion-item">
              <div class="motion-item-head">
                <div>
                  <strong>${escapeHtml(segment.word_prompt || segment.label || "Untitled")}</strong>
                  <div class="motion-subtitle">${escapeHtml(segment.filename || segment.video_id)} · score ${score.toFixed(2)}</div>
                </div>
              </div>
              <div class="motion-item-actions">
                <a class="btn btn--ghost" href="/?replay=${escapeHtml(segment.id)}">Play in Rig</a>
              </div>
            </div>`
          )
          .join("")
      : `<p class="motion-subtitle">No matches.</p>`;
  } catch (error) {
    window.alert(error.message);
  }
});

checkApi();
refreshVideos().catch(() => {});
