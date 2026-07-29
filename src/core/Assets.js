import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

/**
 * Loads the GLB assets produced by tools/blender/build.py and hands out clones.
 *
 * Two things make this worth its own module:
 *
 *  1. Everything is preloaded once, up front, so the rest of the game can build
 *     characters synchronously. Entity constructors are called mid-frame during
 *     spawns; they cannot await.
 *  2. Blender exports carry material slots by NAME only (no textures). We swap
 *     each one for the real procedurally-textured material from MaterialLibrary
 *     at clone time, which is what keeps modeled assets and JS-generated
 *     terrain looking like the same world.
 */

/** Joint names Animator drives. Must match docs/CONTRACTS.md §11. */
export const JOINT_NAMES = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'shoulderL', 'elbowL', 'wristL',
  'shoulderR', 'elbowR', 'wristR',
  'hipL', 'kneeL', 'ankleL',
  'hipR', 'kneeR', 'ankleR',
];

const ATTACH_NAMES = ['handR', 'handL', 'back', 'headTop'];

export class Assets {
  constructor(basePath = './assets/models/') {
    this.base = basePath;
    this.loader = new GLTFLoader();
    /** @type {Map<string, THREE.Object3D>} prototype scenes, never mutated */
    this.protos = new Map();
    this.manifest = null;
    this.ready = false;
    this.missing = new Set();
  }

  /**
   * Fetch the manifest and every GLB it lists.
   * @param {(loaded:number, total:number, name:string)=>void} [onProgress]
   */
  async preload(onProgress) {
    try {
      const res = await fetch(`${this.base}manifest.json`);
      if (!res.ok) throw new Error(`manifest ${res.status}`);
      this.manifest = await res.json();
    } catch (e) {
      // Modeled assets are an optional fidelity layer; every caller has a
      // procedural fallback, so an absent manifest is a supported configuration.
      console.info('[assets] no manifest; using procedural models', e.message);
      this.manifest = { assets: {} };
      this.ready = true;
      return this;
    }

    const names = Object.keys(this.manifest.assets || {});
    let done = 0;
    // Sequential rather than parallel: these come off local disk, and a burst of
    // concurrent GLTF parses stalls the main thread worse than doing them in order.
    for (const name of names) {
      try {
        const gltf = await this.loader.loadAsync(`${this.base}${name}.glb`);
        gltf.scene.updateMatrixWorld(true);
        this.protos.set(name, gltf.scene);
        if (gltf.animations?.length) gltf.scene.userData.animations = gltf.animations;
      } catch (e) {
        console.warn(`[assets] failed to load '${name}'`, e.message);
        this.missing.add(name);
      }
      onProgress?.(++done, names.length, name);
    }

    this.ready = true;
    console.log(`[assets] ${this.protos.size}/${names.length} models loaded`);
    return this;
  }

  has(name) { return this.protos.has(name); }

  /**
   * Clone an asset and re-material it.
   * @param {string} name
   * @param {import('../gfx/Materials.js').MaterialLibrary} [materials]
   * @returns {THREE.Object3D|null}
   */
  instance(name, materials = null) {
    const proto = this.protos.get(name);
    if (!proto) {
      if (!this.missing.has(name)) {
        this.missing.add(name);
        console.info(`[assets] optional model '${name}' unavailable; using procedural fallback`);
      }
      return null;
    }
    // SkeletonUtils.clone rebinds skinned meshes to the cloned skeleton;
    // Object3D.clone() does not and produces characters that never animate.
    const root = cloneSkinned(proto);
    if (materials) this.applyMaterials(root, materials);
    return root;
  }

  /** Swap each Blender material slot for the real one, by name. */
  applyMaterials(root, materials) {
    root.traverse((o) => {
      if (!o.isMesh && !o.isSkinnedMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      const swap = (m) => (m && m.name ? materials.get(m.name) || m : m);
      o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
    });
    return root;
  }

  /**
   * Build a Rig (docs/CONTRACTS.md §11) from a modeled, skinned asset.
   * Returns null if the asset is absent, so callers can fall back to
   * procedurally-generated geometry.
   * @returns {{root:THREE.Group, joints:Object, attach:Object, height:number,
   *            radius:number, meshes:THREE.Mesh[], dispose:Function}|null}
   */
  rig(name, { materials = null, scale = 1 } = {}) {
    const inst = this.instance(name, materials);
    if (!inst) return null;

    const root = new THREE.Group();
    root.add(inst);
    if (scale !== 1) inst.scale.setScalar(scale);

    const joints = {};
    const attach = {};
    const meshes = [];
    const byName = new Map();

    inst.traverse((o) => {
      if (o.name) byName.set(o.name, o);
      if (o.isMesh || o.isSkinnedMesh) meshes.push(o);
    });

    for (const j of JOINT_NAMES) {
      const bone = byName.get(j);
      if (bone) joints[j] = bone;
      else {
        // Never hand Animator an undefined joint — it rotates these blind.
        const stub = new THREE.Object3D();
        stub.name = `${j}__stub`;
        inst.add(stub);
        joints[j] = stub;
      }
    }
    for (const a of ATTACH_NAMES) {
      attach[a] = byName.get(a) || joints[a === 'handR' ? 'wristR' : a === 'handL' ? 'wristL' : 'chest'];
    }

    const box = new THREE.Box3().setFromObject(inst);
    const size = box.getSize(new THREE.Vector3());

    return {
      root,
      joints,
      attach,
      height: size.y || 1.8,
      radius: Math.max(0.25, Math.max(size.x, size.z) * 0.42),
      meshes,
      source: name,
      dispose() {
        // SkeletonUtils clones Object3D/bones, but intentionally shares mesh
        // geometry with the cached prototype. The Assets instance owns that
        // shared buffer and releases it in Assets.dispose(); disposing it on a
        // map change would invalidate every later clone of the same character.
        root.parent?.remove(root);
        meshes.length = 0;
      },
    };
  }

  /** Static prop/structure clone — no skeleton, no per-instance material cost. */
  prop(name, materials = null) {
    return this.instance(name, materials);
  }

  dispose() {
    for (const p of this.protos.values()) {
      p.traverse((o) => {
        o.geometry?.dispose?.();
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of ms) m?.dispose?.();
      });
    }
    this.protos.clear();
  }
}

/** Single shared instance; Game wires it into ctx. */
export const assets = new Assets();
export default assets;
