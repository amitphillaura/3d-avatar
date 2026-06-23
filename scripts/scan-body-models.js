import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const BODY_DIR = path.join(ROOT, "public/models/body");
const REGISTRY_PATH = path.join(ROOT, "public/models/registry.json");
const MANIFEST_PATH = path.join(BODY_DIR, "manifest.json");

function humanizeName(filename) {
  return filename
    .replace(/\.glb$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function idFromFilename(filename) {
  return filename.replace(/\.glb$/i, "");
}

function readRegistry() {
  try {
    return JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8"));
  } catch {
    return { bodyOverrides: {} };
  }
}

function scanBodyModels() {
  if (!fs.existsSync(BODY_DIR)) {
    fs.mkdirSync(BODY_DIR, { recursive: true });
  }

  const overrides = readRegistry().bodyOverrides || {};
  const files = fs
    .readdirSync(BODY_DIR)
    .filter((name) => name.toLowerCase().endsWith(".glb"))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

  const models = files.map((filename) => {
    const override = overrides[filename] || {};
    return {
      id: override.id || idFromFilename(filename),
      name: override.name || humanizeName(filename),
      file: `body/${filename}`,
      rig: override.rig || "meshy",
      defaultAnimation: override.defaultAnimation || "",
      notes:
        override.notes ||
        "Auto-discovered from public/models/body/. Optional metadata in registry.json bodyOverrides."
    };
  });

  const manifest = {
    generatedAt: new Date().toISOString(),
    models
  };

  fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  return models.length;
}

const count = scanBodyModels();
console.log(`Scanned ${count} body model(s) -> public/models/body/manifest.json`);
