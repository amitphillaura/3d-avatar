// Project-bundled media. Drop files into /media/videos or /media/images and Vite's
// import.meta.glob picks them up automatically (dev + build) — no manifest to maintain.
// `?url` yields the served URL string, so large videos are NOT inlined into the bundle;
// they stream from their original path just like the old public/sample.mp4 drop.
const videoModules = import.meta.glob("/media/videos/*.{mp4,webm,mov,m4v,ogv,ogg}", {
  query: "?url",
  import: "default",
  eager: true
});

const imageModules = import.meta.glob("/media/images/*.{jpg,jpeg,png,gif,webp,avif,bmp}", {
  query: "?url",
  import: "default",
  eager: true
});

function baseName(path) {
  return path.split("/").pop() || path;
}

function toEntries(modules, kind) {
  return Object.entries(modules)
    .map(([path, url]) => ({ kind, url, name: baseName(path) }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

/** All bundled media, grouped by kind. */
export function getProjectMedia() {
  return {
    videos: toEntries(videoModules, "video"),
    images: toEntries(imageModules, "image")
  };
}

// Best-effort poster frame for a video tile. Same-origin (Vite-served), so the canvas
// is never tainted. Resolves to a JPEG data URL, or null if the frame can't be grabbed.
export function captureVideoPoster(url, width = 200) {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "metadata";
    video.crossOrigin = "anonymous";
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      video.removeAttribute("src");
      video.load();
      resolve(value);
    };

    const grab = () => {
      try {
        const ratio = video.videoHeight && video.videoWidth ? video.videoHeight / video.videoWidth : 0.5625;
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = Math.max(1, Math.round(width * ratio));
        canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
        done(canvas.toDataURL("image/jpeg", 0.62));
      } catch {
        done(null);
      }
    };

    video.addEventListener("loadeddata", () => {
      const seekTo = Math.min(0.2, (video.duration || 1) / 2);
      try {
        video.currentTime = seekTo;
      } catch {
        grab();
      }
    });
    video.addEventListener("seeked", grab, { once: true });
    video.addEventListener("error", () => done(null), { once: true });
    window.setTimeout(() => done(null), 4000);

    video.src = url;
  });
}
