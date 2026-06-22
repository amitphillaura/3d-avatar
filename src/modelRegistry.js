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
    const response = await fetch(modelUrl(file), { method: "HEAD" });
    return response.ok;
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
