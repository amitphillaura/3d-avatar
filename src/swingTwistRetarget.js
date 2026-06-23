import * as THREE from "three";

// Mesh2Motion Rig.fromConfig reference axes
export const CHAIN_AXES = {
  head: { swing: new THREE.Vector3(0, 0, 1), twist: new THREE.Vector3(0, 1, 0) },
  armL: { swing: new THREE.Vector3(1, 0, 0), twist: new THREE.Vector3(0, 0, -1) },
  armR: { swing: new THREE.Vector3(-1, 0, 0), twist: new THREE.Vector3(0, 0, -1) },
  legL: { swing: new THREE.Vector3(0, 0, 1), twist: new THREE.Vector3(0, -1, 0) },
  legR: { swing: new THREE.Vector3(0, 0, 1), twist: new THREE.Vector3(0, -1, 0) },
  spine: { swing: new THREE.Vector3(0, 1, 0), twist: new THREE.Vector3(0, 0, 1) }
};

const _parentWorld = new THREE.Quaternion();
const _currentWorld = new THREE.Quaternion();
const _finalWorld = new THREE.Quaternion();
const _swingDir = new THREE.Vector3();
const _twistDir = new THREE.Vector3();
const _swingDelta = new THREE.Quaternion();
const _twistDelta = new THREE.Quaternion();
const _local = new THREE.Quaternion();
const _swing = new THREE.Vector3();
const _plane = new THREE.Vector3();
const _twist = new THREE.Vector3();
const _fallback = new THREE.Vector3();

export function createChainItem(bone, axes = CHAIN_AXES.head) {
  if (!bone) return null;

  const worldQuat = new THREE.Quaternion();
  bone.updateWorldMatrix(true, false);
  bone.getWorldQuaternion(worldQuat);
  const inv = worldQuat.clone().invert();

  return {
    bone,
    restLocal: bone.quaternion.clone(),
    swing: axes.swing.clone().applyQuaternion(inv).normalize(),
    twist: axes.twist.clone().applyQuaternion(inv).normalize()
  };
}

function quatSwing(fromDir, toDir, out = _swingDelta) {
  const a = fromDir.clone().normalize();
  const b = toDir.clone().normalize();
  const dot = a.dot(b);

  if (dot < -0.999999) {
    const axis = _fallback.set(-1, 0, 0).cross(a);
    if (axis.lengthSq() < 1e-6) axis.set(0, 1, 0).cross(a);
    return out.setFromAxisAngle(axis.normalize(), Math.PI);
  }

  if (dot > 0.999999) return out.identity();

  const axis = new THREE.Vector3().crossVectors(a, b);
  return out.set(axis.x, axis.y, axis.z, 1 + dot).normalize();
}

/** Mesh2Motion Retargeter.applyChain joint solve. */
export function applyJointSwingTwist(item, sourceSwing, sourceTwist, lerp = 0.35) {
  if (!item?.bone?.parent || !sourceSwing || !sourceTwist) return;

  item.bone.parent.updateWorldMatrix(true, false);
  item.bone.parent.getWorldQuaternion(_parentWorld);
  _currentWorld.multiplyQuaternions(_parentWorld, item.restLocal);

  _swingDir.copy(item.swing).applyQuaternion(_currentWorld).normalize();
  quatSwing(_swingDir, sourceSwing, _swingDelta);
  _finalWorld.multiplyQuaternions(_swingDelta, _currentWorld);

  _twistDir.copy(item.twist).applyQuaternion(_finalWorld).normalize();
  quatSwing(_twistDir, sourceTwist, _twistDelta);
  _finalWorld.multiplyQuaternions(_twistDelta, _finalWorld);

  _local.copy(_parentWorld).invert().multiply(_finalWorld);
  item.bone.quaternion.slerp(_local, lerp);
}

/**
 * Landmark segment → swing/twist with a pole point to lock the limb plane
 * (stops elbows/wrists folding through the torso on turns).
 */
export function computeSegmentSwingTwist(from, to, pole) {
  if (!from || !to) return null;

  _swing.subVectors(to, from);
  if (_swing.lengthSq() < 1e-8) return null;
  _swing.normalize();

  if (pole) {
    _plane.subVectors(pole, from);
    if (_plane.lengthSq() < 1e-8) _plane.set(0, 1, 0);
    _plane.normalize();
    _plane.addScaledVector(_swing, -_plane.dot(_swing));
    if (_plane.lengthSq() < 1e-8) {
      _plane.crossVectors(_swing, _fallback.set(0, 1, 0));
    }
    _twist.copy(_plane).normalize();
  } else {
    _twist.crossVectors(_swing, _fallback.set(0, 1, 0));
    if (_twist.lengthSq() < 1e-8) _twist.set(0, 0, 1);
    _twist.normalize();
  }

  return { swing: _swing.clone(), twist: _twist.clone() };
}

export function lerpDirections(a, b, t, out = new THREE.Vector3()) {
  return out.copy(a).lerp(b, t).normalize();
}
