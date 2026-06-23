const MODELS_BASE = `${import.meta.env.BASE_URL}models/`;

const DEFAULT_BODY = [
  {
    id: "xbot",
    name: "Male Base",
    file: "character.glb",
    rig: "mixamo",
    defaultAnimation: "idle",
    notes: "Included Mixamo rig with idle, walk, run, and more."
  }
];

export function modelUrl(file) {
  return `${MODELS_BASE}${file}`.replace(/\/{2,}/g, "/").replace(":/", "://");
}

export async function rescanBodyModels() {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}api/rescan-models`, {
      method: "POST",
      cache: "no-store"
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load ${url}`);

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("text/html")) {
    throw new Error(`Invalid JSON response from ${url}`);
  }

  return response.json();
}

async function loadBodyManifest() {
  try {
    const manifest = await fetchJson(`${MODELS_BASE}body/manifest.json`);
    return manifest.models || [];
  } catch {
    return [];
  }
}

export async function loadModelRegistry() {
  const registry = await fetchJson(`${MODELS_BASE}registry.json`);
  const discovered = await loadBodyManifest();
  const staticBody = (registry.body || []).filter((entry) => !entry.file?.startsWith("body/"));
  const legacyBody =
    discovered.length === 0
      ? (registry.body || []).filter((entry) => entry.file?.startsWith("body/"))
      : [];
  const body = [...staticBody, ...discovered, ...legacyBody];

  return {
    ...registry,
    body: body.length ? body : DEFAULT_BODY
  };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

export async function probeModelFile(file) {
  try {
    const url = modelUrl(file);
    const headResponse = await fetchWithTimeout(url, {
      method: "HEAD",
      cache: "no-store"
    });

    if (!headResponse.ok) return false;

    const headType = headResponse.headers.get("content-type") || "";
    if (headType.includes("text/html")) return false;

    if (/\.glb($|\?)/i.test(file)) {
      const response = await fetchWithTimeout(url, {
        cache: "no-store",
        headers: { Range: "bytes=0-3" }
      });
      const contentType = response.headers.get("content-type") || "";
      if (!response.ok || contentType.includes("text/html")) return false;

      const bytes = new Uint8Array(await response.arrayBuffer());
      return (
        bytes.length >= 4 &&
        bytes[0] === 0x67 &&
        bytes[1] === 0x6c &&
        bytes[2] === 0x54 &&
        bytes[3] === 0x46
      );
    }

    return true;
  } catch {
    return false;
  }
}

export async function enrichRegistry(registry) {
  const check = async (entry) => ({
    ...entry,
    available: await probeModelFile(entry.file)
  });

  return {
    ...registry,
    body: await Promise.all((registry.body || []).map(check)),
    face: await Promise.all((registry.face || []).map(check))
  };
}
