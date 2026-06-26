const API_BASE = "";

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

/** Mount Motion Library in the main page dock (bottom-right). */
export function initMotionLibrary(options = {}) {
  const onPlaySegment = options.onPlaySegment || ((segmentId) => {
    window.location.href = `/?replay=${encodeURIComponent(segmentId)}`;
  });
  const getUploadMeta =
    options.getUploadMeta ||
    (() => ({ rig_variant: "mushy", tracking_mode: "both" }));
  const onStatus = options.onStatus || (() => {});

  const apiStatusEl = document.getElementById("motionApiStatus");
  const videoListEl = document.getElementById("motionVideoList");
  const detailPanelEl = document.getElementById("motionDetailPanel");
  const detailTitleEl = document.getElementById("motionDetailTitle");
  const detailMetaEl = document.getElementById("motionDetailMeta");
  const segmentListEl = document.getElementById("motionSegmentList");
  const searchResultsEl = document.getElementById("motionSearchResults");
  const processBtn = document.getElementById("motionProcessVideo");
  const deleteBtn = document.getElementById("motionDeleteVideo");
  const autoTagBtn = document.getElementById("motionAutoTagVideo");
  const tagsPanel = document.getElementById("motionTagsPanel");
  const tagsList = document.getElementById("motionTagsList");

  if (!videoListEl) return null;

  let selectedVideoId = null;
  let pollTimer = null;

  function renderVideos(videos) {
    if (!videos.length) {
      videoListEl.innerHTML = `<p class="motion-dock-empty">No videos yet — send the current clip or upload one.</p>`;
      return;
    }

    videoListEl.innerHTML = videos
      .map(
        (video) => `
      <div class="motion-dock-item${video.id === selectedVideoId ? " is-selected" : ""}">
        <button type="button" class="motion-dock-item-main" data-action="open" data-id="${escapeHtml(video.id)}">
          <strong>${escapeHtml(video.filename)}</strong>
          <span class="motion-dock-item-meta">${video.frame_count || 0} fr · ${escapeHtml(video.rig_variant)}</span>
        </button>
        <div class="motion-dock-item-side">
          ${statusPill(video.status)}
        </div>
      </div>`
      )
      .join("");
  }

  function renderSegments(segments) {
    if (!segmentListEl) return;
    if (!segments.length) {
      segmentListEl.innerHTML = `<p class="motion-dock-empty">No segments — mark a frame range below.</p>`;
      return;
    }

    segmentListEl.innerHTML = segments
      .map(
        (segment) => `
      <div class="motion-dock-item motion-dock-item--segment">
        <div class="motion-dock-item-main motion-dock-item-main--static">
          <strong>${escapeHtml(segment.label || "Untitled")}</strong>
          <span class="motion-dock-item-meta">${segment.start_frame}–${segment.end_frame} · ${escapeHtml(segment.word_prompt || "no prompt")}</span>
        </div>
        <div class="motion-dock-item-actions">
          <button type="button" class="btn btn--small" data-segment-action="play" data-id="${escapeHtml(segment.id)}">Play</button>
          <button type="button" class="btn btn--small btn--ghost" data-segment-action="matrix" data-id="${escapeHtml(segment.id)}">Matrix</button>
          <button type="button" class="btn btn--small btn--ghost" data-segment-action="export" data-id="${escapeHtml(segment.id)}">JSON</button>
        </div>
      </div>`
      )
      .join("");
  }

  function renderTags(tags) {
    if (!tagsPanel || !tagsList) return;
    if (!tags || !tags.length) {
      tagsPanel.hidden = true;
      return;
    }
    tagsPanel.hidden = false;
    tagsList.innerHTML = tags
      .map(t => `<span class="motion-tag">${escapeHtml(t.tag_value)}</span>`)
      .join("");
  }

  function syncDetailActions(video) {
    if (!processBtn || !deleteBtn) return;
    const processing = video?.status === "processing";
    processBtn.disabled = processing;
    deleteBtn.disabled = processing;
    processBtn.textContent = video?.status === "ready" ? "Reprocess" : "Process";
  }

  async function refreshVideos() {
    const { videos } = await api("/api/videos");
    renderVideos(videos);
    if (selectedVideoId) {
      const current = videos.find((video) => video.id === selectedVideoId);
      syncDetailActions(current);
      if (current?.status === "processing") {
        clearTimeout(pollTimer);
        pollTimer = window.setTimeout(refreshVideos, 2000);
      }
    }
    return videos;
  }

  async function openVideo(videoId) {
    const detail = await api(`/api/videos/${videoId}`);
    selectedVideoId = videoId;
    if (detailPanelEl) detailPanelEl.hidden = false;
    if (detailTitleEl) detailTitleEl.textContent = detail.video.filename;
    if (detailMetaEl) {
      detailMetaEl.innerHTML = [
        statusPill(detail.video.status),
        `<span class="motion-pill">${escapeHtml(detail.video.rig_variant)}</span>`,
        `<span class="motion-pill">${detail.video.frame_count || 0} fr</span>`
      ].join("");
    }
    const endInput = document.getElementById("motionSegmentEnd");
    if (endInput) endInput.value = Math.max(30, (detail.video.frame_count || 30) - 1);
    syncDetailActions(detail.video);
    renderTags(detail.tags);
    renderSegments(detail.segments);
    await refreshVideos();
    return detail;
  }

  function closeDetail() {
    selectedVideoId = null;
    if (detailPanelEl) detailPanelEl.hidden = true;
    refreshVideos().catch(() => {});
  }

  async function checkApi() {
    if (!apiStatusEl) return;
    try {
      await api("/api/health");
      apiStatusEl.textContent = "API online";
      apiStatusEl.classList.add("motion-api-status--ok");
      apiStatusEl.classList.remove("motion-api-status--warn");
    } catch (error) {
      apiStatusEl.textContent = "API offline";
      apiStatusEl.title = `Run npm run backend (${error.message})`;
      apiStatusEl.classList.add("motion-api-status--warn");
      apiStatusEl.classList.remove("motion-api-status--ok");
    }
  }

  async function uploadFile(file) {
    if (!file) return null;
    const meta = getUploadMeta();
    const body = new FormData();
    body.append("file", file);
    body.append("rig_variant", meta.rig_variant || "mushy");
    body.append("tracking_mode", meta.tracking_mode || "both");
    const result = await api("/api/videos", { method: "POST", body });
    await refreshVideos();
    await openVideo(result.video_id);
    onStatus(`Uploaded ${file.name}`, "success");
    return result;
  }

  document.getElementById("motionSearchForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const q = document.getElementById("motionSearchQuery")?.value.trim() || "";
    if (!searchResultsEl) return;
    try {
      const { results } = await api(`/api/search/motion?q=${encodeURIComponent(q)}`);
      searchResultsEl.hidden = false;
      searchResultsEl.innerHTML = results.length
        ? results
            .map(
              ({ segment, score }) => `
            <div class="motion-dock-item motion-dock-item--segment">
              <div class="motion-dock-item-main motion-dock-item-main--static">
                <strong>${escapeHtml(segment.word_prompt || segment.label || "Untitled")}</strong>
                <span class="motion-dock-item-meta">score ${score.toFixed(2)}</span>
              </div>
              <button type="button" class="btn btn--small" data-search-play="${escapeHtml(segment.id)}">Play</button>
            </div>`
            )
            .join("")
        : `<p class="motion-dock-empty">No matches.</p>`;
    } catch (error) {
      onStatus(error.message, "danger");
    }
  });

  document.getElementById("motionSearchClear")?.addEventListener("click", () => {
    if (!searchResultsEl) return;
    searchResultsEl.hidden = true;
    searchResultsEl.innerHTML = "";
    const input = document.getElementById("motionSearchQuery");
    if (input) input.value = "";
  });

  searchResultsEl?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-search-play]");
    if (!button) return;
    onPlaySegment(button.dataset.searchPlay);
  });

  document.getElementById("motionRefreshVideos")?.addEventListener("click", () => {
    refreshVideos().catch((error) => onStatus(error.message, "danger"));
  });

  document.getElementById("motionUploadFile")?.addEventListener("change", async (event) => {
    const input = event.target;
    const [file] = input.files || [];
    input.value = "";
    if (!file) return;
    try {
      await uploadFile(file);
    } catch (error) {
      onStatus(error.message, "danger");
    }
  });

  videoListEl.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action]");
    if (!button || button.dataset.action !== "open") return;
    try {
      await openVideo(button.dataset.id);
    } catch (error) {
      onStatus(error.message, "danger");
    }
  });

  document.getElementById("motionCloseDetail")?.addEventListener("click", closeDetail);

  processBtn?.addEventListener("click", async () => {
    if (!selectedVideoId) return;
    try {
      await api(`/api/videos/${selectedVideoId}/process`, { method: "POST" });
      onStatus("Processing video…", "warning");
      await refreshVideos();
      await openVideo(selectedVideoId);
    } catch (error) {
      onStatus(error.message, "danger");
    }
  });

  deleteBtn?.addEventListener("click", async () => {
    if (!selectedVideoId) return;
    if (!window.confirm("Delete this video and all segments?")) return;
    try {
      await api(`/api/videos/${selectedVideoId}`, { method: "DELETE" });
      closeDetail();
      onStatus("Video deleted", "success");
    } catch (error) {
      onStatus(error.message, "danger");
    }
  });

  if (autoTagBtn) {
    autoTagBtn.addEventListener("click", async () => {
      if (!selectedVideoId) return;
      autoTagBtn.disabled = true;
      autoTagBtn.textContent = "Tagging...";
      try {
        const result = await api("/api/detect/auto-tag", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ videoId: selectedVideoId }),
        });
        autoTagBtn.textContent = `Tagged (${result.tagsAdded?.length || 0})`;
        // Refresh to show new tags
        await openVideo(selectedVideoId);
      } catch (err) {
        autoTagBtn.textContent = "Error";
        console.error("Auto-tag failed:", err);
      } finally {
        setTimeout(() => {
          autoTagBtn.disabled = false;
          autoTagBtn.textContent = "Auto-tag";
        }, 3000);
      }
    });
  }

  document.getElementById("motionSegmentForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!selectedVideoId) return;
    try {
      await api(`/api/videos/${selectedVideoId}/segments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start_frame: Number(document.getElementById("motionSegmentStart")?.value),
          end_frame: Number(document.getElementById("motionSegmentEnd")?.value),
          label: document.getElementById("motionSegmentLabel")?.value,
          motion_type: document.getElementById("motionSegmentMotionType")?.value,
          word_prompt: document.getElementById("motionSegmentWordPrompt")?.value
        })
      });
      await openVideo(selectedVideoId);
      onStatus("Segment created", "success");
    } catch (error) {
      onStatus(error.message, "danger");
    }
  });

  segmentListEl?.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-segment-action]");
    if (!button) return;
    const segmentId = button.dataset.id;
    try {
      if (button.dataset.segmentAction === "play") {
        onPlaySegment(segmentId);
        return;
      }
      if (button.dataset.segmentAction === "matrix") {
        await api(`/api/segments/${segmentId}/build-matrix`, { method: "POST" });
        await openVideo(selectedVideoId);
        onStatus("Matrix built", "success");
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
      onStatus(error.message, "danger");
    }
  });

  checkApi();
  refreshVideos().catch(() => {});

  return {
    refreshVideos,
    openVideo,
    uploadFile,
    closeDetail,
    getSelectedVideoId: () => selectedVideoId
  };
}
