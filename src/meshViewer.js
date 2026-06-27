/**
 * MeshViewer — a small, self-contained Three.js viewer for a single GLB.
 *
 * Built clean (rather than carved out of the 1300-line vrmEditor monolith) so it
 * can become the canonical shared GLB viewer the rest of the app migrates onto.
 *
 * TripoSR output ships per-vertex colors (COLOR_0) with NO material, so we
 * enable `material.vertexColors` after load — otherwise the mesh renders flat.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

function disposeObject(obj) {
  obj.traverse((node) => {
    if (!node.isMesh) return;
    node.geometry?.dispose?.();
    const mat = node.material;
    if (Array.isArray(mat)) mat.forEach((m) => m?.dispose?.());
    else mat?.dispose?.();
  });
}

export class MeshViewer {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
    this.camera.position.set(0, 0, 3);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(1, 2, 3);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.5);
    fill.position.set(-2, 1, -1);
    this.scene.add(fill);

    this.loader = new GLTFLoader();
    this.current = null;

    this._onResize = () => this.resize();
    window.addEventListener("resize", this._onResize);
    this.resize();

    this._tick = this._tick.bind(this);
    this._raf = requestAnimationFrame(this._tick);
  }

  _tick() {
    this._raf = requestAnimationFrame(this._tick);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  resize() {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  clear() {
    if (!this.current) return;
    this.scene.remove(this.current);
    disposeObject(this.current);
    this.current = null;
  }

  /** Parse and display a GLB from an ArrayBuffer. */
  async loadArrayBuffer(buffer) {
    const gltf = await this.loader.parseAsync(buffer, "");
    this._setModel(gltf.scene);
    return gltf;
  }

  _setModel(obj) {
    this.clear();

    obj.traverse((node) => {
      if (!node.isMesh) return;
      const geo = node.geometry;
      const mat = node.material;
      const textured = !!(mat && mat.map); // SF3D ships a real UV/PBR material

      // Smooth shading. TripoSR's marching-cubes output is faceted ("clay"), so
      // recompute smooth normals. For a textured PBR mesh (SF3D) keep its own
      // normals if present so the bake reads correctly; only fill in if missing.
      if (geo && (!textured || !geo.getAttribute("normal"))) {
        geo.computeVertexNormals();
      }

      if (mat) {
        mat.flatShading = false;
        if (!textured) {
          // Untextured TripoSR: show vertex colors on a matte surface.
          if (geo?.getAttribute("color")) mat.vertexColors = true;
          if ("roughness" in mat) mat.roughness = 0.85; // matte, not plastic
          if ("metalness" in mat) mat.metalness = 0.0;
        }
        mat.needsUpdate = true;
      }
    });

    // Center at origin and frame the camera to the bounding box.
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    obj.position.sub(center);

    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const dist = maxDim * 2.2;
    this.camera.position.set(0, maxDim * 0.1, dist);
    this.camera.near = maxDim / 100;
    this.camera.far = maxDim * 100;
    this.camera.updateProjectionMatrix();
    this.controls.target.set(0, 0, 0);
    this.controls.update();

    this.scene.add(obj);
    this.current = obj;
  }

  dispose() {
    cancelAnimationFrame(this._raf);
    window.removeEventListener("resize", this._onResize);
    this.clear();
    this.controls.dispose();
    this.renderer.dispose();
  }
}
