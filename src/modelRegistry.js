const MODELS_BASE = `${import.meta.env.BASE_URL}models/`;

export function modelUrl(file) {
  return `${MODELS_BASE}${file}`.replace(/\/{2,}/g, "/").replace(":/", "://");
}

export async function loadModelRegistry() {
  const response = await fetch(`${MODELS_BASE}registry.json`);
  if (!response.ok) throw new Error("Could not load models/registry.json");
  return response.json();
}

export async function probeModelFile(file) {
  try {
    const url = modelUrl(file);
    const headResponse = await fetch(url, {
      method: "HEAD",
      cache: "no-store"
    });

    if (!headResponse.ok) return false;

    const headType = headResponse.headers.get("content-type") || "";
    if (headType.includes("text/html")) return false;

    // Vite's HTML fallback can make a missing GLB path look like a 200.
    // Confirm the first bytes are GLB magic bytes instead of trusting status only.
    if (/\.glb($|\?)/i.test(file)) {
      const response = await fetch(url, {
        cache: "no-store",
        headers: { Range: "bytes=0-3" }
      });
      const contentType = response.headers.get("content-type") || "";
      if (!response.ok || contentType.includes("text/html")) return false;

      const bytes = new Uint8Array(await response.arrayBuffer());
      return (
        bytes.length >= 4 &&
        bytes[0] === 0x67 && // g
        bytes[1] === 0x6c && // l
        bytes[2] === 0x54 && // T
        bytes[3] === 0x46 // F
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
