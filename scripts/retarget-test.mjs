// Regression test for the GLB world-landmark body retarget path in mushyModelAvatar.js.
// The production fix drives skinned GLB bones from MediaPipe WORLD landmarks with a
// bind-relative direction+pole solver. This works for both T-pose Mixamo and down-arm Meshy
// because it does not assume a canonical T-pose bind. Run: node scripts/retarget-test.mjs
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

// Minimal browser shims so GLTFLoader can ignore textures in Node.
globalThis.self = globalThis;
globalThis.URL = { createObjectURL: () => "blob:dummy", revokeObjectURL: () => {} };
globalThis.createImageBitmap = async () => ({ close() {} });

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const MODELS = [
  {
    label: "Mixamo Male Base",
    file: path.join(ROOT, "..", "public", "models", "character.glb"),
    pairs: {
      rightUpper: ["mixamorigRightArm", "mixamorigRightForeArm"],
      leftUpper: ["mixamorigLeftArm", "mixamorigLeftForeArm"]
    }
  },
  {
    label: "Meshy Gray Bodysuit",
    file: path.join(ROOT, "..", "public", "models", "body", "meshy-01.glb"),
    pairs: {
      rightUpper: ["RightArm", "RightForeArm"],
      leftUpper: ["LeftArm", "LeftForeArm"]
    }
  },
  {
    label: "Meshy Violet Vanguard",
    file: path.join(ROOT, "..", "public", "models", "body", "meshy-02.glb"),
    pairs: {
      rightUpper: ["RightArm", "RightForeArm"],
      leftUpper: ["LeftArm", "LeftForeArm"]
    }
  }
].filter((model) => existsSync(model.file));

function resolve(root, name) {
  let f = null;
  const n = (s) => s.replace(/[:_]/g, "").toLowerCase();
  root.traverse((o) => { if (!f && n(o.name) === n(name)) f = o; });
  return f;
}

async function loadGltf(file) {
  const buf = readFileSync(file);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return await new Promise((resolveOk, reject) => new GLTFLoader().parse(ab, "", resolveOk, reject));
}

function projectOntoPlane(vector, normal, out) {
  out.copy(vector).addScaledVector(normal, -vector.dot(normal));
  return out.lengthSq() > 1e-8 ? out.normalize() : null;
}

function makeEntry(scene, boneName, childName) {
  const bone = resolve(scene, boneName);
  const child = resolve(scene, childName);
  if (!bone || !child) throw new Error(`Missing ${boneName} -> ${childName}`);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  bone.getWorldPosition(a);
  child.getWorldPosition(b);
  const restWorldQuat = bone.getWorldQuaternion(new THREE.Quaternion());
  const poleBone = child.children.find((node) => node.isBone);
  const entry = {
    bone,
    restLocalQuat: bone.quaternion.clone(),
    restWorldQuat,
    restWorldDir: b.sub(a).normalize()
  };
  if (poleBone) {
    const p = new THREE.Vector3();
    poleBone.getWorldPosition(p);
    const poleDir = p.sub(a);
    if (poleDir.lengthSq() > 1e-8) {
      entry.restPoleDir = poleDir.normalize().applyQuaternion(restWorldQuat.clone().invert()).normalize();
    }
  }
  return entry;
}

const scratch = {
  dir: new THREE.Vector3(),
  delta: new THREE.Quaternion(),
  desired: new THREE.Quaternion(),
  parentQuat: new THREE.Quaternion(),
  targetPole: new THREE.Vector3(),
  targetPolePlane: new THREE.Vector3(),
  currentPolePlane: new THREE.Vector3()
};

function aimSegment(entry, start, end) {
  const { dir, delta, desired, parentQuat } = scratch;
  dir.subVectors(end, start);
  if (dir.lengthSq() < 1e-6) return false;
  dir.normalize();
  delta.setFromUnitVectors(entry.restWorldDir, dir);
  desired.multiplyQuaternions(delta, entry.restWorldQuat);
  entry.bone.parent.getWorldQuaternion(parentQuat);
  parentQuat.invert();
  desired.premultiply(parentQuat);
  entry.bone.quaternion.copy(desired);
  return true;
}

function aimSegmentWithPole(entry, start, end, pole) {
  if (!aimSegment(entry, start, end)) return false;
  if (!entry.restPoleDir || !pole) return true;
  const { dir, delta, desired, parentQuat, targetPole, targetPolePlane, currentPolePlane } = scratch;
  targetPole.subVectors(pole, start);
  if (!projectOntoPlane(targetPole, dir, targetPolePlane)) return true;
  entry.bone.parent.updateWorldMatrix(true, false);
  entry.bone.parent.getWorldQuaternion(parentQuat);
  const currentWorld = new THREE.Quaternion().multiplyQuaternions(parentQuat, entry.bone.quaternion);
  if (!projectOntoPlane(entry.restPoleDir.clone().applyQuaternion(currentWorld), dir, currentPolePlane)) return true;
  delta.setFromUnitVectors(currentPolePlane, targetPolePlane);
  desired.multiplyQuaternions(delta, currentWorld);
  parentQuat.invert();
  desired.premultiply(parentQuat);
  entry.bone.quaternion.copy(desired);
  return true;
}

function dirOf(entry) {
  const child = entry.bone.children.find((node) => node.isBone);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  entry.bone.getWorldPosition(a);
  child.getWorldPosition(b);
  return b.sub(a).normalize();
}

const poses = {
  rightUp: {
    start: new THREE.Vector3(-0.18, 0.5, 0),
    end: new THREE.Vector3(-0.18, 1.05, 0),
    pole: new THREE.Vector3(-0.18, 1.35, 0.1)
  },
  rightForward: {
    start: new THREE.Vector3(-0.18, 0.5, 0),
    end: new THREE.Vector3(-0.18, 0.5, 0.65),
    pole: new THREE.Vector3(-0.18, 0.25, 0.85)
  },
  rightSide: {
    start: new THREE.Vector3(-0.18, 0.5, 0),
    end: new THREE.Vector3(-0.72, 0.5, 0),
    pole: new THREE.Vector3(-0.9, 0.42, 0.12)
  },
  leftUp: {
    start: new THREE.Vector3(0.18, 0.5, 0),
    end: new THREE.Vector3(0.18, 1.05, 0),
    pole: new THREE.Vector3(0.18, 1.35, 0.1)
  },
  leftSide: {
    start: new THREE.Vector3(0.18, 0.5, 0),
    end: new THREE.Vector3(0.72, 0.5, 0),
    pole: new THREE.Vector3(0.9, 0.42, 0.12)
  }
};

let pass = 0;
let total = 0;
for (const model of MODELS) {
  const gltf = await loadGltf(model.file);
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  const right = makeEntry(scene, ...model.pairs.rightUpper);
  const left = makeEntry(scene, ...model.pairs.leftUpper);
  const checks = [];
  const expect = (name, cond, got) => checks.push({ name, ok: Boolean(cond), got });

  console.log(`\n${model.label}`);

  aimSegmentWithPole(right, poses.rightUp.start, poses.rightUp.end, poses.rightUp.pole);
  scene.updateMatrixWorld(true);
  let d = dirOf(right);
  expect("right arm points UP (+y)", d.y > 0.85, d);

  right.bone.quaternion.copy(right.restLocalQuat);
  scene.updateMatrixWorld(true);
  aimSegmentWithPole(right, poses.rightForward.start, poses.rightForward.end, poses.rightForward.pole);
  scene.updateMatrixWorld(true);
  d = dirOf(right);
  expect("right arm points FORWARD (+z)", d.z > 0.85, d);

  right.bone.quaternion.copy(right.restLocalQuat);
  scene.updateMatrixWorld(true);
  aimSegmentWithPole(right, poses.rightSide.start, poses.rightSide.end, poses.rightSide.pole);
  scene.updateMatrixWorld(true);
  d = dirOf(right);
  expect("right arm points SIDE (-x)", d.x < -0.85, d);

  left.bone.quaternion.copy(left.restLocalQuat);
  scene.updateMatrixWorld(true);
  aimSegmentWithPole(left, poses.leftUp.start, poses.leftUp.end, poses.leftUp.pole);
  scene.updateMatrixWorld(true);
  d = dirOf(left);
  expect("left arm points UP (+y)", d.y > 0.85, d);

  left.bone.quaternion.copy(left.restLocalQuat);
  scene.updateMatrixWorld(true);
  aimSegmentWithPole(left, poses.leftSide.start, poses.leftSide.end, poses.leftSide.pole);
  scene.updateMatrixWorld(true);
  d = dirOf(left);
  expect("left arm points SIDE (+x)", d.x > 0.85, d);

  for (const c of checks) {
    total += 1;
    const g = `[${c.got.x.toFixed(2)},${c.got.y.toFixed(2)},${c.got.z.toFixed(2)}]`;
    console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}  got=${g}`);
    if (c.ok) pass += 1;
  }
}
console.log(`\n${pass}/${total} passed`);
process.exit(pass === total ? 0 : 1);
