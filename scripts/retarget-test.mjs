// Regression test for the Kalidokit -> Mixamo change-of-basis used in mushyModelAvatar.js.
// Drives the bundled Mixamo GLB with synthetic Kalidokit poses through the exact same
// quaternion math (C=Ry180 + three-vrm normalized->raw chain) and asserts the resulting
// bone world directions are anatomically correct. Run: node scripts/retarget-test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Pose as KalidoPose } from "kalidokit/dist/kalidokit.es.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const GLB = path.join(ROOT, "..", "public", "models", "character.glb");

// Mirror of the production constant in mushyModelAvatar.js
const C = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
const Cinv = C.clone().invert();

const blank = () => Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 1 }));
const set = (l, i, x, y, z) => (l[i] = { x, y, z, visibility: 1 });
// MediaPipe world-y points DOWN; above hips = negative y. 11/13/15 = MP-left arm (Kalidokit
// RightUpperArm); 12/14/16 = MP-right arm (LeftUpperArm).
function buildPose({ lE, lW, rE, rW }) {
  const l = blank();
  set(l, 0, 0, -0.65, 0.05);
  set(l, 11, 0.18, -0.5, 0); set(l, 12, -0.18, -0.5, 0);
  set(l, 13, ...lE); set(l, 15, ...lW); set(l, 14, ...rE); set(l, 16, ...rW);
  set(l, 17, lW[0], lW[1] + 0.05, lW[2]); set(l, 19, lW[0] + 0.03, lW[1] + 0.05, lW[2]);
  set(l, 18, rW[0], rW[1] + 0.05, rW[2]); set(l, 20, rW[0] - 0.03, rW[1] + 0.05, rW[2]);
  set(l, 23, 0.1, 0, 0); set(l, 24, -0.1, 0, 0);
  return l;
}
const T = { lE: [0.45, -0.5, 0], lW: [0.72, -0.5, 0], rE: [-0.45, -0.5, 0], rW: [-0.72, -0.5, 0] };
const POSES = {
  tpose: buildPose(T),
  mpLeftUp: buildPose({ ...T, lE: [0.18, -0.78, 0], lW: [0.18, -1.05, 0] }),
  mpLeftFwd: buildPose({ ...T, lE: [0.18, -0.5, 0.27], lW: [0.18, -0.5, 0.54] }),
  mpRightUp: buildPose({ ...T, rE: [-0.18, -0.78, 0], rW: [-0.18, -1.05, 0] })
};

const VRM2MIX = { RightUpperArm: "mixamorigRightArm", LeftUpperArm: "mixamorigLeftArm" };
const resolve = (root, name) => {
  let f = null; const n = (s) => s.replace(/[:_]/g, "").toLowerCase();
  root.traverse((o) => { if (!f && n(o.name) === n(name)) f = o; });
  return f;
};

const buf = readFileSync(GLB);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
new GLTFLoader().parse(ab, "", (gltf) => {
  const scene = gltf.scene; scene.updateMatrixWorld(true);
  const bones = {};
  for (const [vrm, mix] of Object.entries(VRM2MIX)) {
    const bone = resolve(scene, mix);
    const Wp = new THREE.Quaternion(); (bone.parent || scene).getWorldQuaternion(Wp);
    bones[vrm] = { bone, Wp, WpInv: Wp.clone().invert(), Lrest: bone.quaternion.clone() };
  }
  const drive = (solved) => {
    for (const b of Object.values(bones)) b.bone.quaternion.copy(b.Lrest);
    for (const [vrm, b] of Object.entries(bones)) {
      const e = solved[vrm]; if (!e) continue;
      const rk = new THREE.Quaternion().setFromEuler(new THREE.Euler(e.x, e.y, e.z, "XYZ"));
      rk.premultiply(C).multiply(Cinv);                                  // C * R_k * C^-1
      b.bone.quaternion.copy(rk).multiply(b.Wp).premultiply(b.WpInv).multiply(b.Lrest);
    }
    scene.updateMatrixWorld(true);
  };
  const dir = (bone) => {
    const c = bone.children.find((x) => x.isBone);
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    bone.getWorldPosition(a); c.getWorldPosition(b);
    return b.sub(a).normalize();
  };

  const checks = [];
  const expect = (name, cond, got) => checks.push({ name, ok: cond, got });
  let s;
  s = KalidoPose.solve(POSES.mpLeftUp, POSES.mpLeftUp, { runtime: "mediapipe", enableLegs: false });
  drive(s); let d = dir(bones.RightUpperArm.bone);
  expect("mpLeftUp: RightArm points UP (+y)", d.y > 0.5, d);
  s = KalidoPose.solve(POSES.mpLeftFwd, POSES.mpLeftFwd, { runtime: "mediapipe", enableLegs: false });
  drive(s); d = dir(bones.RightUpperArm.bone);
  expect("mpLeftFwd: RightArm points FORWARD (+z)", d.z > 0.5, d);
  s = KalidoPose.solve(POSES.mpRightUp, POSES.mpRightUp, { runtime: "mediapipe", enableLegs: false });
  drive(s); d = dir(bones.LeftUpperArm.bone);
  expect("mpRightUp: LeftArm points UP (+y)", d.y > 0.5, d);
  s = KalidoPose.solve(POSES.tpose, POSES.tpose, { runtime: "mediapipe", enableLegs: false });
  drive(s); const rd = dir(bones.RightUpperArm.bone), ld = dir(bones.LeftUpperArm.bone);
  expect("tpose: RightArm stays to the side (-x)", rd.x < -0.5, rd);
  expect("tpose: LeftArm stays to the side (+x)", ld.x > 0.5, ld);

  let pass = 0;
  for (const c of checks) {
    const g = `[${c.got.x.toFixed(2)},${c.got.y.toFixed(2)},${c.got.z.toFixed(2)}]`;
    console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}  got=${g}`);
    if (c.ok) pass++;
  }
  console.log(`\n${pass}/${checks.length} passed`);
  process.exit(pass === checks.length ? 0 : 1);
}, (e) => { console.error(e); process.exit(1); });
