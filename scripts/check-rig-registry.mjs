#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rigHostPath = join(root, "src/rigHost.js");
const indexPath = join(root, "index.html");

function fail(message) {
  console.error(`check-rig-registry: ${message}`);
  process.exit(1);
}

function read(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    fail(`Could not read ${path}`);
  }
}

function parseRegistryKeys(source) {
  const block = source.match(/export const RIG_VARIANTS = \{([\s\S]*?)\};/);
  if (!block) fail("Could not find RIG_VARIANTS in src/rigHost.js");
  return [...block[1].matchAll(/^\s+(\w+):/gm)].map((match) => match[1]);
}

function parseRegistryModules(source) {
  const block = source.match(/export const RIG_VARIANTS = \{([\s\S]*?)\};/);
  if (!block) fail("Could not find RIG_VARIANTS in src/rigHost.js");
  const entries = [...block[1].matchAll(/^\s+(\w+):[\s\S]*?import\("\.\/([^"]+)"\)/gm)];
  return new Map(entries.map((match) => [match[1], match[2]]));
}

function parseDropdownValues(html) {
  const select = html.match(/<select id="rigVariant"[\s\S]*?<\/select>/);
  if (!select) fail('Could not find <select id="rigVariant"> in index.html');
  return [...select[0].matchAll(/<option value="([^"]+)"/g)].map((match) => match[1]);
}

function diff(label, onlyA, onlyB) {
  const problems = [];
  if (onlyA.length) problems.push(`${label} only in registry: ${onlyA.join(", ")}`);
  if (onlyB.length) problems.push(`${label} only in dropdown: ${onlyB.join(", ")}`);
  return problems;
}

const rigHostSource = read(rigHostPath);
const indexSource = read(indexPath);

const registryKeys = parseRegistryKeys(rigHostSource);
const registryModules = parseRegistryModules(rigHostSource);
const dropdownValues = parseDropdownValues(indexSource);

const registrySet = new Set(registryKeys);
const dropdownSet = new Set(dropdownValues);

const problems = [
  ...diff(
    "Keys",
    registryKeys.filter((key) => !dropdownSet.has(key)),
    dropdownValues.filter((value) => !registrySet.has(value))
  )
];

if (registryKeys.length !== registrySet.size) {
  problems.push("Duplicate keys in RIG_VARIANTS");
}
if (dropdownValues.length !== dropdownSet.size) {
  problems.push('Duplicate <option value="…"> entries in rig dropdown');
}

for (const [key, moduleFile] of registryModules) {
  const modulePath = join(root, "src", moduleFile);
  if (!existsSync(modulePath)) {
    problems.push(`Registry key "${key}" points to missing module src/${moduleFile}`);
  }
}

for (const key of registryKeys) {
  if (!registryModules.has(key)) {
    problems.push(`Registry key "${key}" is missing a static import("./…") loader`);
  }
}

if (problems.length) {
  problems.forEach((problem) => console.error(`check-rig-registry: ${problem}`));
  process.exit(1);
}

console.log(
  `check-rig-registry: OK — ${registryKeys.length} variants synced (registry, dropdown, modules).`
);
