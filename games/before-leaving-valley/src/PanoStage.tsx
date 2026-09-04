/* Node-and-look renderer. One wide painted image per node, wrapped onto a
   partial sphere (150° wide, 84° tall) around the camera so the player can
   look around from a fixed standpoint (Myst III / Riven style). DOM anchors tagged with
   data-yaw / data-pitch (degrees) inside the anchor layer are projected every
   frame so hotspots and props stay glued to the painting.

   The camera is also her body: a body mode (standing, walking, running,
   climbing, crawling, riding) shapes the continuous sway, and one-shot
   impulses (a foot landing, a slip, a pull-up, a car bump, a brake) hit a set
   of springs so the view reacts and settles like a head on shoulders. */
import { useEffect, useRef } from "react";
import * as THREE from "three";

export type LookPoint = { x: number; y: number };
export type BreathState = "calm" | "walking" | "recovery";
export type BodyMode = "stand" | "walk" | "run" | "climb" | "crawl" | "ride";
export type ImpulseKind = "step" | "land" | "slip" | "pull" | "clink" | "jolt" | "brake" | "turn" | "shout" | "settle" | "glance";
export type StageHandle = { kick: (kind: ImpulseKind, strength?: number, direction?: { yaw: number; pitch: number }) => void };

export const PANO_HFOV = 150;      // degrees of the cylinder covered by one image
export const CAMERA_FOV = 60;      // vertical field of view in degrees
export const YAW_LIMIT = 40;       // upper bound on how far left/right the gaze can turn (narrowed to the painting's edge at runtime)
export const PITCH_LIMIT = 13;
const PANO_VFOV = PANO_HFOV * 9 / 16; // degrees of the cylinder covered vertically by one image

type Props = {
  asset: string;
  light: "day" | "dusk" | "night" | "interior" | "dawn";
  look: LookPoint;                // -1..1 pointer position, drives the gaze
  walking: boolean;
  progress: number;               // 0..1 walk progress toward the next node
  breath: BreathState;
  mode?: BodyMode;                // what her body is doing in this node
  tension?: number;               // 0..1 shaking hands / racing heart (crawl and climb)
  handleRef?: { current: StageHandle | null };
  idle?: boolean;                 // when true and the pointer rests, the gaze wanders slowly on its own
  anchorLayerRef: { current: HTMLDivElement | null };
  reduceMotion?: boolean;
  onReady?: () => void;
  onGaze?: (yaw: number, pitch: number) => void;
};

const BREATH: Record<BreathState, { frequency: number; amplitude: number; roll: number }> = {
  calm: { frequency: 0.2, amplitude: 0.25, roll: 0.0009 },
  walking: { frequency: 0.55, amplitude: 0.5, roll: 0.0022 },
  recovery: { frequency: 0.42, amplitude: 0.9, roll: 0.003 },
};

/* Gait: how the head bobs while moving in each mode (frequency in Hz, amplitudes in degrees / radians). */
const GAIT: Record<BodyMode, { frequency: number; pitch: number; yaw: number; roll: number; zoom: number; pitchOffset: number }> = {
  stand: { frequency: 0, pitch: 0, yaw: 0, roll: 0, zoom: 0, pitchOffset: 0 },
  walk: { frequency: 1.7, pitch: 0.6, yaw: 0.35, roll: 0.002, zoom: 0, pitchOffset: 0 },
  run: { frequency: 2.7, pitch: 1.35, yaw: 0.7, roll: 0.006, zoom: -0.04, pitchOffset: -2.5 },
  climb: { frequency: 0.35, pitch: 0.5, yaw: 0.25, roll: 0.0025, zoom: 0.02, pitchOffset: 3 },
  crawl: { frequency: 0.95, pitch: 1.3, yaw: 0.5, roll: 0.006, zoom: 0.03, pitchOffset: -6 },
  ride: { frequency: 0, pitch: 0, yaw: 0, roll: 0, zoom: 0, pitchOffset: 0 },
};

const TINT: Record<Props["light"], number> = {
  day: 0xffffff,
  dusk: 0xf6d9c4,
  night: 0x8a94a8,
  interior: 0xf3e6d6,
  dawn: 0xe7edf7,
};

type Spring = { p: number; v: number; k: number; c: number };
const spring = (k: number, c: number): Spring => ({ p: 0, v: 0, k, c });
const integrate = (s: Spring, dt: number) => {
  const a = -s.k * s.p - s.c * s.v;
  s.v += a * dt;
  s.p += s.v * dt;
};
const sign = () => (Math.random() < 0.5 ? -1 : 1);

function makePanel(texture: THREE.Texture | null) {
  const radius = 10;
  const phiLength = THREE.MathUtils.degToRad(PANO_HFOV);
  const thetaLength = THREE.MathUtils.degToRad(PANO_VFOV);
  // Sphere section centred on -Z: in three.js z = r·sin(phi)·sin(theta), so phi = -90° faces -Z.
  const geometry = new THREE.SphereGeometry(radius, 96, 48, -Math.PI / 2 - phiLength / 2, phiLength, Math.PI / 2 - thetaLength / 2, thetaLength);
  const material = new THREE.MeshBasicMaterial({ ...(texture ? { map: texture } : {}), side: THREE.BackSide, transparent: true, opacity: texture ? 1 : 0, color: 0xffffff });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.scale.x = -1; // undo the mirror that BackSide viewing produces
  return mesh;
}

export default function PanoStage({ asset, light, look, walking, progress, breath, mode = "stand", tension = 0, handleRef, idle = false, anchorLayerRef, reduceMotion = false, onReady, onGaze }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const assetRef = useRef(asset);
  const lightRef = useRef(light);
  const lookRef = useRef(look);
  const walkingRef = useRef(walking);
  const progressRef = useRef(progress);
  const breathRef = useRef(breath);
  const modeRef = useRef(mode);
  const tensionRef = useRef(tension);
  const idleRef = useRef(idle);
  const lookChangedAtRef = useRef(performance.now());
  const reduceRef = useRef(reduceMotion);
  const gazeRef = useRef(onGaze);
  const requestRef = useRef<{ asset: string; token: number }>({ asset, token: 0 });
  const springsRef = useRef({ pitch: spring(70, 9.5), yaw: spring(70, 9.5), roll: spring(90, 11), zoom: spring(60, 10) });

  useEffect(() => { lightRef.current = light; }, [light]);
  useEffect(() => { lookRef.current = look; lookChangedAtRef.current = performance.now(); }, [look]);
  useEffect(() => { idleRef.current = idle; if (!idle) lookChangedAtRef.current = performance.now(); }, [idle]);
  useEffect(() => { walkingRef.current = walking; }, [walking]);
  useEffect(() => { progressRef.current = progress; }, [progress]);
  useEffect(() => { breathRef.current = breath; }, [breath]);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { tensionRef.current = tension; }, [tension]);
  useEffect(() => { reduceRef.current = reduceMotion; }, [reduceMotion]);
  useEffect(() => { gazeRef.current = onGaze; }, [onGaze]);
  useEffect(() => {
    assetRef.current = asset;
    requestRef.current = { asset, token: requestRef.current.token + 1 };
  }, [asset]);

  /* One-shot body impulses. Each kind pushes the springs a characteristic way. */
  useEffect(() => {
    if (!handleRef) return;
    const kick = (kind: ImpulseKind, strength = 1, direction?: { yaw: number; pitch: number }) => {
      const s = strength * (reduceRef.current ? 0.35 : 1);
      const { pitch, yaw, roll, zoom } = springsRef.current;
      switch (kind) {
        case "step": pitch.v -= 6 * s; zoom.v += 0.03 * s; break;
        case "land": pitch.v -= 26 * s; roll.v += 0.05 * s * sign(); zoom.v += 0.1 * s; break;
        case "slip": pitch.v -= 34 * s; yaw.v += 16 * s * sign(); roll.v += 0.16 * s * sign(); zoom.v -= 0.06 * s; break;
        case "pull": pitch.v -= 22 * s; yaw.v += 4 * s * sign(); zoom.v += 0.14 * s; break;
        case "clink": pitch.v -= 3 * s; zoom.v += 0.01 * s; break;
        case "jolt": pitch.v += (10 + 10 * s) * sign(); roll.v += 0.04 * s * sign(); zoom.v += 0.02 * s; break;
        case "brake": pitch.v -= 28 * s; zoom.v += 0.08 * s; break;
        case "turn": roll.v += 0.12 * s * sign(); yaw.v += 8 * s * sign(); break;
        case "shout": zoom.v -= 0.16 * s; pitch.v += 8 * s; break;
        case "settle": pitch.v -= 4 * s; zoom.v += 0.05 * s; break;
        case "glance": yaw.v += (direction?.yaw ?? 0) * s; pitch.v += (direction?.pitch ?? 0) * s; break;
        default: break;
      }
    };
    handleRef.current = { kick };
    return () => { handleRef.current = null; };
  }, [handleRef]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.setClearColor(0x0b1114, 1);
    host.appendChild(renderer.domElement);
    renderer.domElement.className = "pano-canvas";

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 16 / 9, 0.1, 100);
    camera.position.set(0, 0, 0);
    const loader = new THREE.TextureLoader();
    // Only a few paintings stay resident: the one on screen, the one fading out and the next one being prefetched.
    const textures = new Map<string, THREE.Texture>();
    const TEXTURE_CACHE = 3;
    let currentName = "";
    let previousName = "";
    let failures = 0;
    const evict = () => {
      for (const [name, texture] of textures) {
        if (textures.size <= TEXTURE_CACHE) break;
        if (name === currentName || name === previousName) continue;
        texture.dispose();
        textures.delete(name);
      }
    };

    let current = makePanel(null);
    let previous: THREE.Mesh | null = null;
    scene.add(current);
    let loadedToken = -1;
    let fade = 1;          // 0..1 opacity of the current panel
    let previousPeak = 1;  // opacity the outgoing panel had when the swap started
    let stepZoom = 0;      // forward-step zoom applied during transitions
    let yaw = 0;
    let pitch = 0;
    let yawLimit = YAW_LIMIT;
    let pitchLimit = PITCH_LIMIT;
    let halfHfov = 45;
    let elapsed = 0;
    let readyFired = false;
    // Ride: the road throws the car around on its own schedule.
    let nextJolt = 1.6;
    let nextTurn = 5;
    let rideTime = 0;
    // Tension: a slow random walk of the hands, filtered so it reads as trembling rather than noise.
    let jitterPitch = 0;
    let jitterYaw = 0;
    let jitterTargetPitch = 0;
    let jitterTargetYaw = 0;
    let nextJitter = 0;
    let modePitch = 0;     // eased pitch offset of the current body mode
    let modeZoom = 0;
    let lastStepSign = 1;
    let drift = 0;         // 0..1 how much the idle wander is blended in

    const resize = () => {
      const width = host.clientWidth || window.innerWidth;
      const height = host.clientHeight || window.innerHeight;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      // Keep the whole image height visible on tall windows, the whole width on wide ones.
      camera.fov = Math.max(CAMERA_FOV, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV) / 2) * (16 / 9) / camera.aspect)));
      camera.updateProjectionMatrix();
      halfHfov = THREE.MathUtils.radToDeg(Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * camera.aspect));
      // The view may turn only as far as the painting reaches, so its edges never show.
      yawLimit = Math.max(6, Math.min(YAW_LIMIT, PANO_HFOV / 2 - halfHfov - 1.5));
      pitchLimit = Math.max(3, Math.min(PITCH_LIMIT, PANO_VFOV / 2 - camera.fov / 2 - 1.8));
    };
    resize();
    window.addEventListener("resize", resize);
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(() => resize()) : null;
    observer?.observe(host);
    const onContextLost = (event: Event) => { event.preventDefault(); };
    const onContextRestored = () => { fade = Math.min(fade, 0.999); (current.material as THREE.MeshBasicMaterial).needsUpdate = true; };
    renderer.domElement.addEventListener("webglcontextlost", onContextLost);
    renderer.domElement.addEventListener("webglcontextrestored", onContextRestored);

    const load = (name: string) => new Promise<THREE.Texture>((resolve, reject) => {
      const cached = textures.get(name);
      if (cached) { textures.delete(name); textures.set(name, cached); return resolve(cached); }
      loader.load(`${import.meta.env.BASE_URL}${name}`, (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
        textures.set(name, texture);
        resolve(texture);
      }, undefined, reject);
    });

    const swapTo = (texture: THREE.Texture, name: string) => {
      if (previous) {
        scene.remove(previous);
        (previous.material as THREE.MeshBasicMaterial).dispose();
        previous.geometry.dispose();
      }
      previous = current;
      previousName = currentName;
      previousPeak = (previous.material as THREE.MeshBasicMaterial).opacity;
      current = makePanel(texture);
      currentName = name;
      (current.material as THREE.MeshBasicMaterial).opacity = 0;
      scene.add(current);
      fade = 0;
      stepZoom = 1;
      // Arriving: the last step lands and the body settles.
      springsRef.current.pitch.v -= 5;
      springsRef.current.zoom.v += 0.04;
      evict();
    };

    const tick = () => {
      if (disposed) return;
      const request = requestRef.current;
      if (request.token !== loadedToken) {
        loadedToken = request.token;
        const token = request.token;
        void load(request.asset).then((texture) => {
          if (disposed || requestRef.current.token !== token) return;
          failures = 0;
          if (!(current.material as THREE.MeshBasicMaterial).map) {
            (current.material as THREE.MeshBasicMaterial).map = texture;
            (current.material as THREE.MeshBasicMaterial).opacity = 1;
            (current.material as THREE.MeshBasicMaterial).needsUpdate = true;
            currentName = request.asset;
            fade = 1;
          } else swapTo(texture, request.asset);
          if (!readyFired) { readyFired = true; onReady?.(); }
        }).catch(() => {
          // A failed load is retried a few times instead of leaving the previous painting under the new hotspots.
          if (disposed || requestRef.current.token !== token) return;
          failures += 1;
          if (failures <= 5) window.setTimeout(() => { if (!disposed && requestRef.current.token === token) loadedToken = -1; }, 1200 * failures);
        });
      }
    };

    let last = performance.now();
    const frame = (now: number) => {
      if (disposed) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      elapsed += dt;
      tick();

      const motion = reduceRef.current ? 0.25 : 1;
      const moving = walkingRef.current;
      const mode: BodyMode = moving ? (modeRef.current === "run" ? "run" : "walk") : modeRef.current;
      const gait = GAIT[mode];
      const springs = springsRef.current;

      // Idle wander: after the pointer has rested a while in a "look at the view" node, the gaze drifts slowly.
      const restingFor = (now - lookChangedAtRef.current) / 1000;
      const wantDrift = idleRef.current && !moving && restingFor > 7 ? 1 : 0;
      drift += (wantDrift - drift) * Math.min(1, dt * (wantDrift ? 0.35 : 2.5));
      const wanderYaw = Math.sin(elapsed * Math.PI * 2 / 26) * 7 * drift * motion;
      const wanderPitch = Math.sin(elapsed * Math.PI * 2 / 17 + 1.3) * 2.2 * drift * motion;
      const targetYaw = THREE.MathUtils.clamp(THREE.MathUtils.clamp(lookRef.current.x, -1, 1) * yawLimit + wanderYaw, -yawLimit, yawLimit);
      const targetPitch = THREE.MathUtils.clamp(-THREE.MathUtils.clamp(lookRef.current.y, -1, 1) * pitchLimit + wanderPitch, -pitchLimit, pitchLimit);
      const ease = 1 - Math.exp(-dt * (moving ? 3 : mode === "crawl" ? 4 : drift > 0.5 ? 1.2 : 5.5));
      yaw += (targetYaw - yaw) * ease;
      pitch += (targetPitch - pitch) * ease;

      // Breathing (always) and gait (while the body is doing something).
      const profile = BREATH[breathRef.current];
      const phase = elapsed * Math.PI * 2 * profile.frequency;
      const breathPitch = (Math.sin(phase) * 0.72 + Math.sin(phase * 2 + 0.5) * 0.28) * profile.amplitude * motion;
      const stepPhase = elapsed * Math.PI * 2 * gait.frequency;
      const gaitActive = moving || (mode !== "walk" && mode !== "run" && gait.frequency > 0);
      const stepPitch = gaitActive ? Math.sin(stepPhase) * gait.pitch * motion : 0;
      const stepYaw = gaitActive ? Math.sin(stepPhase * 0.5) * gait.yaw * motion : 0;
      const roll = (Math.sin(phase + 0.8) * profile.roll + (gaitActive ? Math.sin(stepPhase * 0.5) * gait.roll : 0)) * motion;
      // Each footfall while running lands with a small thump.
      if (moving && mode === "run") {
        const stepSign = Math.sign(Math.sin(stepPhase));
        if (stepSign !== lastStepSign && stepSign < 0) { springs.pitch.v -= 7 * motion; springs.zoom.v += 0.02 * motion; }
        lastStepSign = stepSign;
      }
      modePitch += ((gaitActive ? gait.pitchOffset : 0) * motion - modePitch) * Math.min(1, dt * 2.5);
      modeZoom += ((gaitActive ? gait.zoom : 0) - modeZoom) * Math.min(1, dt * 2.5);

      // Riding: engine vibration, the road's bumps and bends.
      let ridePitch = 0;
      let rideRoll = 0;
      if (mode === "ride") {
        rideTime += dt;
        ridePitch = (Math.sin(elapsed * Math.PI * 2 * 13.1) * 0.05 + Math.sin(elapsed * Math.PI * 2 * 7.3) * 0.045) * motion;
        rideRoll = Math.sin(elapsed * Math.PI * 2 * 0.23) * 0.006 * motion;
        if (rideTime > nextJolt) { nextJolt = rideTime + 1.4 + Math.random() * 3.2; const s = 0.35 + Math.random() * 0.65; springs.pitch.v += (8 + 9 * s) * sign() * motion; springs.roll.v += 0.035 * s * sign() * motion; }
        if (rideTime > nextTurn) { nextTurn = rideTime + 5 + Math.random() * 5; springs.roll.v += 0.1 * sign() * motion; springs.yaw.v += 6 * sign() * motion; }
      } else rideTime = 0;

      // Tension: trembling that grows with fear, only while climbing or crawling.
      const tension = (mode === "crawl" || mode === "climb") ? tensionRef.current : 0;
      if (elapsed > nextJitter) {
        nextJitter = elapsed + 0.08 + Math.random() * 0.12;
        jitterTargetPitch = (Math.random() - 0.5) * 1.1 * tension;
        jitterTargetYaw = (Math.random() - 0.5) * 0.8 * tension;
      }
      jitterPitch += (jitterTargetPitch - jitterPitch) * Math.min(1, dt * 18);
      jitterYaw += (jitterTargetYaw - jitterYaw) * Math.min(1, dt * 18);

      integrate(springs.pitch, dt);
      integrate(springs.yaw, dt);
      integrate(springs.roll, dt);
      integrate(springs.zoom, dt);

      camera.rotation.set(0, 0, 0);
      camera.rotateY(THREE.MathUtils.degToRad(-(yaw + stepYaw + jitterYaw * motion + springs.yaw.p)));
      camera.rotateX(THREE.MathUtils.degToRad(pitch + breathPitch + stepPitch + modePitch + ridePitch + jitterPitch * motion + springs.pitch.p));
      camera.rotateZ(roll + rideRoll + springs.roll.p);

      // Forward step: zoom the current panel slightly while walking, and settle after a swap.
      const walkZoom = moving ? progressRef.current * (mode === "run" ? 0.12 : 0.09) : 0;
      stepZoom += (0 - stepZoom) * Math.min(1, dt * 2.2);
      const zoom = 1 + walkZoom + stepZoom * 0.06 + modeZoom + springs.zoom.p;
      camera.zoom += (zoom - camera.zoom) * Math.min(1, dt * 8);
      camera.updateProjectionMatrix();

      if (fade < 1) {
        fade = Math.min(1, fade + dt * 1.6);
        (current.material as THREE.MeshBasicMaterial).opacity = fade;
        if (previous) (previous.material as THREE.MeshBasicMaterial).opacity = previousPeak * (1 - fade);
        if (fade >= 1 && previous) {
          scene.remove(previous);
          (previous.material as THREE.MeshBasicMaterial).dispose();
          previous.geometry.dispose();
          previous = null;
        }
      }
      (current.material as THREE.MeshBasicMaterial).color.setHex(TINT[lightRef.current]);

      renderer.render(scene, camera);

      // Project DOM anchors.
      const layer = anchorLayerRef.current;
      if (layer) {
        const width = host.clientWidth || 1;
        const height = host.clientHeight || 1;
        const vector = new THREE.Vector3();
        layer.querySelectorAll<HTMLElement>("[data-yaw]").forEach((element) => {
          const aYaw = THREE.MathUtils.degToRad(Number(element.dataset.yaw || 0));
          const aPitch = THREE.MathUtils.degToRad(Number(element.dataset.pitch || 0));
          const distance = Number(element.dataset.distance || 10);
          vector.set(Math.sin(aYaw) * Math.cos(aPitch) * distance, Math.sin(aPitch) * distance, -Math.cos(aYaw) * Math.cos(aPitch) * distance);
          const inFront = vector.clone().applyMatrix4(camera.matrixWorldInverse).z < 0;
          vector.project(camera);
          if (!inFront || vector.x < -1.4 || vector.x > 1.4 || vector.y < -1.4 || vector.y > 1.4) {
            element.style.visibility = "hidden";
            return;
          }
          const x = (vector.x + 1) / 2 * width;
          const y = (1 - vector.y) / 2 * height;
          const scale = Math.max(0.6, (10 / distance) * camera.zoom);
          element.style.visibility = "visible";
          element.style.transform = `translate(-50%, -50%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${scale.toFixed(3)})`;
          // Hotspots only show when the gaze comes near them: the player has to look at the painting.
          const reveal = Number(element.dataset.reveal || 0);
          if (reveal > 0) {
            // Where the player is looking: the camera direction plus the pointer's offset inside the view.
            const gazeYaw = yaw + stepYaw + THREE.MathUtils.clamp(lookRef.current.x, -1, 1) * halfHfov * 0.9;
            const gazePitch = pitch + breathPitch + stepPitch + modePitch - THREE.MathUtils.clamp(lookRef.current.y, -1, 1) * (camera.fov / 2) * 0.9;
            const dYaw = THREE.MathUtils.radToDeg(aYaw) - gazeYaw;
            const dPitch = THREE.MathUtils.radToDeg(aPitch) - gazePitch;
            const distanceDeg = Math.hypot(dYaw, dPitch * 1.4);
            const opacity = Math.max(0, Math.min(1, (reveal - distanceDeg) / (reveal * 0.45)));
            element.style.opacity = opacity.toFixed(3);
            element.style.pointerEvents = opacity < 0.2 ? "none" : "auto";
          }
        });
      }
      gazeRef.current?.(yaw + stepYaw, pitch + breathPitch + stepPitch + modePitch);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);

    return () => {
      disposed = true;
      window.removeEventListener("resize", resize);
      observer?.disconnect();
      renderer.domElement.removeEventListener("webglcontextlost", onContextLost);
      renderer.domElement.removeEventListener("webglcontextrestored", onContextRestored);
      [current, previous].forEach((mesh) => { if (!mesh) return; scene.remove(mesh); (mesh.material as THREE.MeshBasicMaterial).dispose(); mesh.geometry.dispose(); });
      textures.forEach((texture) => texture.dispose());
      renderer.dispose();
      renderer.forceContextLoss();
      if (renderer.domElement.parentElement === host) host.removeChild(renderer.domElement);
    };
  }, [anchorLayerRef, onReady]);

  return <div className="pano-host" ref={hostRef} aria-hidden="true" />;
}
