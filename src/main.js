import * as THREE from 'three';
import { Game } from './game/Game.js';
import { CLASSES } from './game/Content.js';
import { autoQuality } from './game/Config.js';
import { assets } from './core/Assets.js';

const boot = (p, msg) => window.__boot?.(p, msg);

const el = (id) => document.getElementById(id);

const SELECT_MODEL_KEYS = [
  'char_warrior_m', 'char_mage_m', 'char_taoist_m',
];

/**
 * Priority loader over the shared Assets cache. Character select needs only
 * three class files; parsing all town NPCs and every weapon before showing the first
 * interactive screen made the boot needlessly long. Remaining models load
 * after the profession is confirmed, using the same prototypes and no repeat.
 */
async function preloadLocalModels(names, onProgress) {
  if (!assets.manifest) {
    try {
      const res = await fetch(`${assets.base}manifest.json`);
      if (!res.ok) throw new Error(`manifest ${res.status}`);
      assets.manifest = await res.json();
    } catch (e) {
      console.info('[assets] no manifest; using procedural models', e.message);
      assets.manifest = { assets: {} };
      assets.ready = true;
      return assets;
    }
  }
  const available = assets.manifest.assets || {};
  const queue = (names || Object.keys(available)).filter((name) => available[name]);
  let done = 0;
  for (const name of queue) {
    if (!assets.protos.has(name)) {
      try {
        const gltf = await assets.loader.loadAsync(`${assets.base}${name}.glb`);
        gltf.scene.updateMatrixWorld(true);
        assets.protos.set(name, gltf.scene);
        if (gltf.animations?.length) gltf.scene.userData.animations = gltf.animations;
      } catch (e) {
        console.warn(`[assets] failed to load '${name}'`, e.message);
        assets.missing.add(name);
      }
    }
    onProgress?.(++done, queue.length, name);
  }
  return assets;
}

/**
 * A self-contained character-select diorama.  It deliberately uses the same
 * Three.js runtime as the game, but no game assets: the three figures are
 * original low-poly sculptures assembled from shaded primitives.  Keeping the
 * preview independent means character selection still works before the GLB
 * preload, and the WebGL context is explicitly released before the game boots.
 */
function makeCharacterPreview(canvas) {
  if (!canvas) return { select() {}, dispose() {} };

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas, alpha: true, antialias: true, powerPreference: 'high-performance',
    });
  } catch (e) {
    console.warn('[character-select] 3D preview unavailable', e);
    canvas.classList.add('no-webgl');
    return { select() {}, dispose() {} };
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(31, 1, 0.1, 40);
  camera.position.set(0, 2.8, 8.3);
  camera.lookAt(0, 2.25, 0);

  scene.add(new THREE.HemisphereLight(0x8ba8cc, 0x201208, 1.65));
  const key = new THREE.DirectionalLight(0xffd3a0, 4.4);
  key.position.set(-3.5, 7, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -4; key.shadow.camera.right = 4;
  key.shadow.camera.top = 6; key.shadow.camera.bottom = -1;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x6e9dff, 3.0);
  rim.position.set(4, 3.8, -4);
  scene.add(rim);
  const warm = new THREE.PointLight(0xff7a2e, 7, 8, 2);
  warm.position.set(-2.2, 1.2, 2.2);
  scene.add(warm);

  const world = new THREE.Group();
  world.position.y = -0.08;
  scene.add(world);

  const std = (color, roughness = 0.62, metalness = 0.08, extra = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
  const glow = (color, intensity = 2.2, opacity = 1) =>
    new THREE.MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: intensity, roughness: 0.24,
      metalness: 0.1, transparent: opacity < 1, opacity,
    });
  const skin = std(0xd8a47d, 0.74, 0);
  const hair = std(0x1a120d, 0.86, 0);
  const black = std(0x0c0907, 0.74, 0.18);
  const gold = std(0xc79b3e, 0.28, 0.82);
  const steel = std(0x9aa4ad, 0.24, 0.9);

  const put = (parent, geometry, material, pos, rot, scale, shadows = true) => {
    const m = new THREE.Mesh(geometry, material);
    if (pos) m.position.set(pos[0], pos[1], pos[2]);
    if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
    if (scale) m.scale.set(scale[0], scale[1], scale[2]);
    m.castShadow = shadows;
    m.receiveShadow = shadows;
    parent.add(m);
    return m;
  };

  // Hammered dais and ritual rings provide grounding and a strong silhouette.
  put(world, new THREE.CylinderGeometry(1.72, 1.98, 0.34, 64), std(0x25170c, 0.48, 0.58), [0, 0.12, 0]);
  put(world, new THREE.CylinderGeometry(1.52, 1.70, 0.12, 64), std(0x49301a, 0.38, 0.72), [0, 0.34, 0]);
  put(world, new THREE.CylinderGeometry(1.40, 1.46, 0.055, 64), std(0x130d09, 0.62, 0.2), [0, 0.43, 0]);
  const floorRing = put(world, new THREE.TorusGeometry(1.38, 0.025, 8, 96), glow(0xe0ad4c, 1.6), [0, 0.47, 0], [Math.PI / 2, 0, 0]);
  const halo = new THREE.Group();
  halo.position.set(0, 2.45, -0.72);
  world.add(halo);
  for (const [r, o] of [[1.78, 0.52], [2.02, 0.25], [2.27, 0.12]]) {
    put(halo, new THREE.TorusGeometry(r, 0.016, 6, 96), glow(0xd7a245, 1.2, o), null, null, null, false);
  }

  const makeFace = (parent, headY = 3.52) => {
    const head = put(parent, new THREE.SphereGeometry(0.36, 24, 18), skin, [0, headY, 0.04], null, [0.92, 1.12, 0.86]);
    put(parent, new THREE.SphereGeometry(0.32, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.54), hair,
      [0, headY + 0.17, 0.005], [0, 0, 0], [1.02, 0.92, 0.94]);
    put(parent, new THREE.SphereGeometry(0.036, 10, 8), black, [-0.125, headY + 0.015, 0.345], null, [1.35, 0.72, 0.52], false);
    put(parent, new THREE.SphereGeometry(0.036, 10, 8), black, [0.125, headY + 0.015, 0.345], null, [1.35, 0.72, 0.52], false);
    put(parent, new THREE.CapsuleGeometry(0.035, 0.08, 4, 8), std(0x9a5c45, 0.8, 0),
      [0, headY - 0.15, 0.355], [0, 0, Math.PI / 2], null, false);
    return head;
  };

  const makeBoots = (parent, cloth) => {
    for (const x of [-0.255, 0.255]) {
      put(parent, new THREE.CapsuleGeometry(0.18, 0.72, 7, 12), cloth, [x, 0.93, 0], null, [0.94, 1, 0.94]);
      put(parent, new THREE.BoxGeometry(0.39, 0.22, 0.62), black, [x, 0.53, 0.13], null, [1, 1, 1]);
    }
  };

  const makeArm = (parent, material, x, y, z, rz, width = 0.17) => {
    const arm = put(parent, new THREE.CapsuleGeometry(width, 0.72, 7, 12), material, [x, y, z], [0, 0, rz]);
    const hand = put(parent, new THREE.SphereGeometry(0.19, 16, 12), skin,
      [x - Math.sin(rz) * 0.49, y - Math.cos(rz) * 0.49, z + 0.01], null, [0.82, 1, 0.78]);
    return { arm, hand };
  };

  const figures = new Map();

  const warrior = new THREE.Group();
  makeBoots(warrior, std(0x302520, 0.7, 0.12));
  put(warrior, new THREE.CapsuleGeometry(0.55, 0.92, 9, 16), std(0x6e2118, 0.55, 0.18), [0, 2.18, 0], null, [1.06, 1, 0.72]);
  // Breastplate planes, belt, shoulder armour and a short battle cape.
  put(warrior, new THREE.BoxGeometry(0.92, 0.82, 0.18), std(0x646970, 0.27, 0.76), [0, 2.33, 0.39], null, [1, 1, 1]);
  put(warrior, new THREE.BoxGeometry(0.74, 0.055, 0.035), gold, [0, 2.49, 0.495], [0, 0, 0.08]);
  put(warrior, new THREE.BoxGeometry(1.08, 0.18, 0.42), std(0x241713, 0.65, 0.28), [0, 1.65, 0.04]);
  put(warrior, new THREE.PlaneGeometry(1.18, 1.62), std(0x4c1414, 0.76, 0, { side: THREE.DoubleSide }),
    [0, 2.03, -0.43], [0.04, 0, 0]);
  for (const x of [-0.69, 0.69]) {
    put(warrior, new THREE.SphereGeometry(0.36, 18, 12), steel, [x, 2.67, 0.02], null, [1.24, 0.58, 1.16]);
    put(warrior, new THREE.BoxGeometry(0.48, 0.07, 0.42), gold, [x, 2.73, 0.13]);
  }
  makeArm(warrior, std(0x4d2520, 0.6, 0.32), -0.68, 2.17, 0.02, -0.24, 0.2);
  makeArm(warrior, std(0x4d2520, 0.6, 0.32), 0.69, 2.23, 0.03, 0.34, 0.2);
  makeFace(warrior);
  // Browed war helm.
  put(warrior, new THREE.SphereGeometry(0.42, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.54), steel,
    [0, 3.71, 0.015], null, [1.03, 0.78, 1.02]);
  put(warrior, new THREE.ConeGeometry(0.09, 0.52, 8), gold, [0, 4.14, -0.02], [0, 0, 0.04]);
  const greatsword = new THREE.Group();
  greatsword.position.set(0.91, 1.78, 0.17);
  greatsword.rotation.z = -0.31;
  warrior.add(greatsword);
  put(greatsword, new THREE.BoxGeometry(0.16, 2.3, 0.075), steel, [0, 0.72, 0.05]);
  put(greatsword, new THREE.ConeGeometry(0.13, 0.35, 4), steel, [0, 2.02, 0.05], [0, 0, Math.PI / 4]);
  put(greatsword, new THREE.BoxGeometry(0.68, 0.10, 0.13), gold, [0, -0.39, 0.05]);
  put(greatsword, new THREE.CapsuleGeometry(0.07, 0.44, 4, 8), black, [0, -0.72, 0.05]);
  warrior.userData.weapon = greatsword;
  warrior.userData.aura = 0xff5a2e;
  world.add(warrior); figures.set('warrior', warrior);

  const mage = new THREE.Group();
  makeBoots(mage, std(0x11162e, 0.72, 0.04));
  put(mage, new THREE.CylinderGeometry(0.56, 0.92, 1.82, 16), std(0x243d86, 0.58, 0.08), [0, 1.41, 0]);
  put(mage, new THREE.CapsuleGeometry(0.48, 0.88, 9, 16), std(0x274c9b, 0.48, 0.1), [0, 2.45, 0], null, [0.88, 1, 0.67]);
  put(mage, new THREE.TorusGeometry(0.49, 0.045, 8, 48, Math.PI * 1.25), gold, [0, 2.52, 0.39], [0, 0, -0.39]);
  put(mage, new THREE.BoxGeometry(1.12, 0.13, 0.34), std(0x151d48, 0.45, 0.32), [0, 2.77, 0.04]);
  makeArm(mage, std(0x293f7f, 0.58, 0.06), -0.56, 2.18, 0.03, -0.48, 0.145);
  makeArm(mage, std(0x293f7f, 0.58, 0.06), 0.57, 2.16, 0.03, 0.36, 0.145);
  makeFace(mage);
  // Arcane circlet and hanging gems.
  put(mage, new THREE.TorusGeometry(0.34, 0.035, 8, 36, Math.PI * 1.25), gold, [0, 3.67, 0.21], [0, 0, -0.39]);
  put(mage, new THREE.OctahedronGeometry(0.095, 0), glow(0x66baff, 3.8), [0, 3.75, 0.36]);
  const staff = new THREE.Group();
  staff.position.set(0.82, 1.55, 0.13);
  staff.rotation.z = -0.08;
  mage.add(staff);
  put(staff, new THREE.CylinderGeometry(0.045, 0.065, 2.65, 12), std(0x6a4020, 0.6, 0.08), [0, 0.62, 0]);
  put(staff, new THREE.TorusGeometry(0.27, 0.045, 10, 36), gold, [0, 2.02, 0]);
  const mageOrb = put(staff, new THREE.IcosahedronGeometry(0.18, 2), glow(0x4c9dff, 4.8), [0, 2.02, 0.02], null, null, false);
  const mageLight = new THREE.PointLight(0x4c9dff, 4.5, 3.4, 2);
  mageLight.position.copy(mageOrb.position); staff.add(mageLight);
  mage.userData.orb = mageOrb;
  mage.userData.aura = 0x4f8dff;
  world.add(mage); figures.set('mage', mage);

  const taoist = new THREE.Group();
  makeBoots(taoist, std(0x17251d, 0.72, 0.04));
  put(taoist, new THREE.CylinderGeometry(0.54, 0.83, 1.72, 16), std(0x1f674d, 0.62, 0.04), [0, 1.46, 0]);
  put(taoist, new THREE.CapsuleGeometry(0.48, 0.84, 9, 16), std(0x2e765d, 0.6, 0.05), [0, 2.43, 0], null, [0.9, 1, 0.68]);
  put(taoist, new THREE.BoxGeometry(1.06, 0.14, 0.30), std(0xd8d0b0, 0.72, 0.03), [0, 2.76, 0.02]);
  put(taoist, new THREE.BoxGeometry(0.98, 0.13, 0.34), gold, [0, 1.68, 0.03]);
  makeArm(taoist, std(0xd8d0b0, 0.72, 0.02), -0.55, 2.18, 0.03, -0.55, 0.15);
  makeArm(taoist, std(0xd8d0b0, 0.72, 0.02), 0.55, 2.18, 0.03, 0.55, 0.15);
  makeFace(taoist);
  put(taoist, new THREE.CylinderGeometry(0.39, 0.41, 0.10, 32), black, [0, 3.78, -0.01]);
  put(taoist, new THREE.BoxGeometry(0.42, 0.26, 0.03), std(0xe2c868, 0.68, 0), [0, 2.40, 0.49]);
  // Floating talismans and a slowly turning spell seal.
  for (const x of [-0.83, 0.83]) {
    put(taoist, new THREE.PlaneGeometry(0.22, 0.55), glow(0xf0c75d, 1.1, 0.92),
      [x, 2.05, 0.44], [0, x < 0 ? -0.24 : 0.24, x < 0 ? -0.16 : 0.16], null, false);
  }
  const seal = new THREE.Group();
  seal.position.set(0, 2.05, -0.62);
  taoist.add(seal);
  put(seal, new THREE.TorusGeometry(0.72, 0.028, 8, 64), glow(0x58e09b, 2.8, 0.72), null, null, null, false);
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3;
    put(seal, new THREE.BoxGeometry(0.28, 0.035, 0.025), glow(0x9cf2bf, 2.0, 0.68),
      [Math.cos(a) * 0.48, Math.sin(a) * 0.48, 0], [0, 0, a], null, false);
  }
  taoist.userData.seal = seal;
  taoist.userData.aura = 0x54d99a;
  world.add(taoist); figures.set('taoist', taoist);

  // Prefer the Blender-authored, skinned class models when the local asset
  // manifest is available. The sculptures above remain a genuine offline
  // fallback for an intentionally asset-free build, never the primary path.
  const previewMaterials = new Map();
  const assetMat = (source) => {
    const name = (source?.name || 'cloth').toLowerCase();
    let color = 0x8f8068, roughness = 0.68, metalness = 0.04;
    let emissive = 0x000000, emissiveIntensity = 0;
    if (name.includes('clothred')) color = 0x781f18;
    else if (name.includes('clothblue')) color = 0x274b9b;
    else if (name.includes('clothgreen')) color = 0x247054;
    else if (name.includes('silk')) color = 0xd6cfb2;
    else if (name.includes('leather')) color = 0x4e2d1d;
    else if (name.includes('skin.pale')) color = 0xe3bda2;
    else if (name.includes('skin')) color = 0xc98f68;
    else if (name.includes('hair')) color = 0x17110d;
    else if (name.includes('steel')) { color = 0xa7b1bf; roughness = 0.22; metalness = 0.92; }
    else if (name.includes('iron')) { color = 0x59616b; roughness = 0.34; metalness = 0.88; }
    else if (name.includes('bronze')) { color = 0x9d6730; roughness = 0.34; metalness = 0.82; }
    else if (name.includes('gold')) { color = 0xd0a244; roughness = 0.25; metalness = 0.88; }
    else if (name.includes('bone')) color = 0xd8caa6;
    else if (name.includes('chitin')) color = 0x342b27;
    else if (name.includes('crystal')) {
      color = 0x6ebcff; roughness = 0.18; metalness = 0.08;
      emissive = 0x246fd0; emissiveIntensity = 3.4;
    } else if (name.includes('rune')) {
      color = 0x76e8ad; roughness = 0.28;
      emissive = 0x21865a; emissiveIntensity = 2.8;
    }
    const keyName = `${name}:${color}`;
    let material = previewMaterials.get(keyName);
    if (!material) {
      material = new THREE.MeshStandardMaterial({
        name: source?.name || name, color, roughness, metalness,
        emissive, emissiveIntensity,
      });
      previewMaterials.set(keyName, material);
    }
    return material;
  };
  const prepareAsset = (root) => {
    root.traverse((o) => {
      if (!o.isMesh && !o.isSkinnedMesh) return;
      // SkeletonUtils intentionally shares GLB geometry; mark it so preview
      // teardown never disposes the prototypes that the live game will clone.
      o.userData.previewSharedGeometry = true;
      o.castShadow = true; o.receiveShadow = true;
      o.material = Array.isArray(o.material) ? o.material.map(assetMat) : assetMat(o.material);
    });
  };
  const modelKeys = {
    warrior: 'char_warrior_m',
    mage: 'char_mage_m',
    taoist: 'char_taoist_m',
  };
  for (const id of ['warrior', 'mage', 'taoist']) {
    const bodyKey = modelKeys[id];
    const body = assets.instance(bodyKey);
    if (!body) continue;
    prepareAsset(body);

    // Centre and ground the character before the shared display scale. GLB
    // characters face -Z; the half turn presents them to our +Z camera.
    body.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(body);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    body.position.set(-center.x, -box.min.y, -center.z);
    body.rotation.y = Math.PI;

    const holder = new THREE.Group();
    holder.name = `select-${bodyKey}`;
    holder.add(body);
    holder.scale.setScalar(4.05 / Math.max(0.2, size.y));
    holder.position.y = 0.46;
    holder.userData.aura = id === 'warrior' ? 0xff5a2e : id === 'mage' ? 0x4f8dff : 0x54d99a;
    const classLight = new THREE.PointLight(holder.userData.aura, 3.2, 3.8, 2);
    classLight.position.set(id === 'mage' ? 0.75 : -0.65, 2.25, 0.75);
    holder.add(classLight);

    const fallback = figures.get(id);
    if (fallback) fallback.visible = false;
    world.add(holder);
    figures.set(id, holder);
  }

  // One reusable point cloud, recoloured as the profession changes.
  const count = 72;
  const particlePositions = new Float32Array(count * 3);
  const particleBase = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const a = i * 2.399963 + 0.4;
    const r = 1.25 + ((i * 37) % 23) / 23 * 1.2;
    const x = Math.cos(a) * r, y = 0.55 + ((i * 47) % 71) / 71 * 3.7, z = Math.sin(a) * r * 0.38 - 0.18;
    particlePositions.set([x, y, z], i * 3);
    particleBase.set([x, y, z], i * 3);
  }
  const particleGeo = new THREE.BufferGeometry();
  particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
  const particleMat = new THREE.PointsMaterial({
    color: 0xff6b38, size: 0.055, transparent: true, opacity: 0.8,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
  });
  const particles = new THREE.Points(particleGeo, particleMat);
  world.add(particles);

  let selected = 'warrior';
  let disposed = false;
  let raf = 0;
  let last = performance.now();
  let width = 0, height = 0;
  let yaw = -0.14;
  let dragging = false, pointerX = 0;

  const select = (id) => {
    if (!figures.has(id)) id = 'warrior';
    selected = id;
    for (const [keyName, figure] of figures) figure.visible = keyName === id;
    particleMat.color.setHex(figures.get(id).userData.aura);
    floorRing.material.color.setHex(figures.get(id).userData.aura);
    floorRing.material.emissive.setHex(figures.get(id).userData.aura);
  };

  const onDown = (e) => {
    dragging = true; pointerX = e.clientX;
    canvas.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e) => {
    if (!dragging) return;
    yaw += (e.clientX - pointerX) * 0.009;
    pointerX = e.clientX;
  };
  const onUp = (e) => {
    dragging = false;
    canvas.releasePointerCapture?.(e.pointerId);
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);

  const frame = (now) => {
    if (disposed) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const w = Math.max(2, canvas.clientWidth | 0), h = Math.max(2, canvas.clientHeight | 0);
    if (w !== width || h !== height) {
      width = w; height = h;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }

    const t = now * 0.001;
    const current = figures.get(selected);
    if (current) {
      current.rotation.y += ((yaw + Math.sin(t * 0.42) * 0.055) - current.rotation.y) * Math.min(1, dt * 7);
      current.position.y = Math.sin(t * 1.7) * 0.018;
      if (current.userData.weapon) current.userData.weapon.rotation.z = -0.31 + Math.sin(t * 1.2) * 0.025;
      if (current.userData.orb) {
        const s = 1 + Math.sin(t * 3.2) * 0.12;
        current.userData.orb.scale.setScalar(s);
      }
      if (current.userData.seal) current.userData.seal.rotation.z = t * 0.22;
    }
    halo.rotation.z = t * 0.035;
    particles.rotation.y = t * 0.08;
    const pa = particleGeo.attributes.position;
    for (let i = 0; i < count; i++) pa.array[i * 3 + 1] = particleBase[i * 3 + 1] + Math.sin(t * 1.45 + i * 0.73) * 0.075;
    pa.needsUpdate = true;
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  };
  select(selected);
  raf = requestAnimationFrame(frame);

  return {
    select,
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      const geometries = new Set(), materials = new Set();
      scene.traverse((o) => {
        if (o.geometry && !o.userData?.previewSharedGeometry) geometries.add(o.geometry);
        if (Array.isArray(o.material)) for (const m of o.material) materials.add(m);
        else if (o.material) materials.add(o.material);
      });
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      renderer.dispose();
      renderer.forceContextLoss?.();
    },
  };
}

/** Character select with an actual, rotatable class sculpture. */
function chooseCharacter() {
  return new Promise((resolve) => {
    const wrap = el('csClasses');
    const desc = el('csDesc');
    const showcase = el('csShowcase');
    const preview = makeCharacterPreview(el('csPreview'));
    const ids = Object.keys(CLASSES);
    const profiles = {
      warrior: { role: '前线破阵 · 重甲近战', stats: [['生存', 96], ['爆发', 84], ['控场', 58]] },
      mage: { role: '元素轰击 · 远程群攻', stats: [['术法', 98], ['范围', 92], ['生存', 42]] },
      taoist: { role: '符箓召唤 · 持续支援', stats: [['续航', 94], ['辅助', 96], ['机动', 72]] },
    };
    let picked = ids[0];

    const render = () => {
      wrap.innerHTML = '';
      for (const id of ids) {
        const c = CLASSES[id];
        const b = document.createElement('button');
        b.className = 'cs-class' + (id === picked ? ' on' : '');
        b.dataset.klass = id;
        b.setAttribute('aria-pressed', id === picked ? 'true' : 'false');
        b.innerHTML = `
          <span class="cs-card-art" aria-hidden="true">
            <i class="cs-card-aura"></i><i class="cs-card-body"></i>
            <i class="cs-card-head"></i><i class="cs-card-weapon"></i>
          </span>
          <span class="cs-card-copy">
            <span class="cs-glyph">${c.glyph}</span>
            <span><span class="cs-cn">${c.name}</span><span class="cs-en">${c.en}</span></span>
          </span>`;
        b.onclick = () => { picked = id; render(); };
        wrap.appendChild(b);
      }
      const c = CLASSES[picked];
      showcase.dataset.klass = picked;
      el('csPreviewGlyph').textContent = c.glyph;
      el('csPreviewName').textContent = c.name;
      el('csPreviewEn').textContent = c.en;
      preview.select(picked);
      const profile = profiles[picked] || profiles.warrior;
      desc.innerHTML = `
        <div class="cs-role">${profile.role}</div>
        <p>${c.desc}</p>
        <ul>${c.highlights.map((h) => `<li>${h}</li>`).join('')}</ul>
        <div class="cs-aptitudes">${profile.stats.map(([name, value]) =>
          `<span><b>${name}</b><i><em style="width:${value}%"></em></i><small>${value}</small></span>`).join('')}</div>`;
    };

    render();
    el('csGo').onclick = () => {
      const name = (el('csName').value || '无名少侠').trim().slice(0, 7);
      preview.dispose();
      el('charsel').classList.add('hidden');
      resolve({ name, klass: picked });
    };
    el('charsel').classList.remove('hidden');
  });
}

async function main() {
  boot(0.1, '正在生成纹理…');
  // Yield so the loading bar paints before the (heavy) synchronous world build.
  const tick = (p, m) => new Promise((r) => { boot(p, m); requestAnimationFrame(() => setTimeout(r, 0)); });

  await tick(0.14, '正在唤醒玛法大陆…');

  // Character selection is the player's first fidelity checkpoint, so the
  // locally-authored GLBs must be available before it opens. The same cache is
  // reused by Game; there is no second parse or network dependency.
  await preloadLocalModels(SELECT_MODEL_KEYS, (n, total, name) => {
    boot(0.14 + 0.34 * (n / Math.max(1, total)), `正在载入职业 ${n}/${total} · ${name}`);
  });

  el('boot').classList.add('hidden');
  const choice = await chooseCharacter();

  el('boot').classList.remove('hidden');
  const allModels = Object.keys(assets.manifest?.assets || {});
  await preloadLocalModels(allModels, (n, total, name) => {
    boot(0.48 + 0.18 * (n / Math.max(1, total)), `正在载入模型 ${n}/${total} · ${name}`);
  });
  assets.ready = true;
  console.log(`[assets] ${assets.protos.size}/${allModels.length} models loaded`);

  await tick(0.68, '正在雕刻地形…');

  const canvas = el('stage');
  const query = new URLSearchParams(location.search);
  const quality = query.get('q') || autoQuality();
  const game = new Game(canvas, { ...choice, quality });
  window.game = game;

  await tick(0.7, '正在放置怪物与 NPC…');
  game.start(query.get('map') || 'bichon');
  // Deterministic visual-QA hook. It is inert for normal players and lets the
  // screenshot loop exercise severe weather on a real GPU without reaching
  // through the page from automation.
  const weather = query.get('weather');
  if (weather) game.weather.set(weather, 1, 0);
  const qaX = Number(query.get('x'));
  const qaZ = Number(query.get('z'));
  if (Number.isFinite(qaX) && Number.isFinite(qaZ) && game.player) {
    game.player.setPosition(qaX, qaZ);
    game.ctx.engine.camTarget.copy(game.player.position);
    game.ctx.engine.snapCamera();
  }

  await tick(1.0, '完成');
  el('boot').classList.add('hidden');
  el('ui').classList.remove('hidden');
}

main().catch((e) => {
  console.error(e);
  const box = el('fatal'), msg = el('fatalMsg');
  box.classList.remove('hidden');
  msg.textContent = (e && (e.stack || e.message)) || String(e);
});
