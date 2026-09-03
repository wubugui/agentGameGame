import { useEffect, useRef } from "react";
import { Application, Assets, Container, Graphics, Sprite } from "pixi.js";
import { JOURNEY_SCENES, JOURNEY_SCENE_INFO, type JourneyScene } from "./journeyModel";

export type { JourneyScene } from "./journeyModel";
export type BreathState = "calm" | "walking" | "recovery";
export type LookPoint = { x: number; y: number };

const SCENE_INDEX = Object.fromEntries(JOURNEY_SCENES.map((scene, index) => [scene, index])) as Record<JourneyScene, number>;

const BREATH_PROFILE: Record<BreathState, { frequency: number; amplitude: number; sway: number }> = {
  calm: { frequency: 0.2, amplitude: 1.6, sway: 0.00055 },
  walking: { frequency: 0.58, amplitude: 2.8, sway: 0.0011 },
  recovery: { frequency: 0.4, amplitude: 4.3, sway: 0.00165 },
};

type Props = {
  scene: JourneyScene;
  walking: boolean;
  progress?: number;
  look: LookPoint;
  walkFocus: LookPoint | null;
  breath: BreathState;
  anchorLayerRef?: { current: HTMLDivElement | null };
  onReady?: () => void;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export default function PixiJourney({ scene, walking, progress = 0, look, walkFocus, breath, anchorLayerRef, onReady }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef(scene);
  const walkingRef = useRef(walking);
  const progressRef = useRef(progress);
  const lookRef = useRef(look);
  const walkFocusRef = useRef(walkFocus);
  const breathRef = useRef(breath);

  useEffect(() => { sceneRef.current = scene; }, [scene]);
  useEffect(() => { walkingRef.current = walking; }, [walking]);
  useEffect(() => { progressRef.current = progress; }, [progress]);
  useEffect(() => { lookRef.current = look; }, [look]);
  useEffect(() => { walkFocusRef.current = walkFocus; }, [walkFocus]);
  useEffect(() => { breathRef.current = breath; }, [breath]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    const app = new Application();
    const sceneContainers: Container[] = [];
    const sceneSprites: Sprite[] = [];
    const baseScales: number[] = [];
    let elapsed = 0;
    let smoothedLook = { x: 0, y: 0 };

    const boot = async () => {
      await app.init({
        resizeTo: host,
        background: "#17242a",
        antialias: true,
        autoDensity: true,
        resolution: Math.min(window.devicePixelRatio, 1.6),
      });
      if (disposed) {
        app.destroy(true);
        return;
      }

      app.canvas.className = "journey-canvas";
      host.appendChild(app.canvas);
      const base = import.meta.env.BASE_URL;
      JOURNEY_SCENES.forEach((_, index) => {
        const container = new Container();
        const sprite = new Sprite();
        sprite.anchor.set(0.5);
        container.addChild(sprite);
        container.alpha = index === SCENE_INDEX[sceneRef.current] ? 1 : 0;
        app.stage.addChild(container);
        sceneContainers.push(container);
        sceneSprites.push(sprite);
      });

      const haze = new Graphics();
      app.stage.addChild(haze);

      const fitSprite = (sprite: Sprite, index: number) => {
        if (sprite.texture.width <= 1 || sprite.texture.height <= 1) return;
        const width = app.screen.width;
        const height = app.screen.height;
        const cover = Math.max(width / sprite.texture.width, height / sprite.texture.height) * 1.15;
        sprite.scale.set(cover);
        baseScales[index] = cover;
        sprite.position.set(width / 2, height / 2);
      };

      const fit = () => {
        const width = app.screen.width;
        const height = app.screen.height;
        // The 15% overscan is the safe crop used by limited head turns,
        // breathing and walking without ever revealing an image edge.
        sceneSprites.forEach(fitSprite);
        haze.clear().rect(0, 0, width, height).fill({ color: 0x071115, alpha: 0.045 });
      };

      fit();
      window.addEventListener("resize", fit);

      const loadSceneTexture = async (journeyScene: JourneyScene) => {
        const index = SCENE_INDEX[journeyScene];
        const texture = await Assets.load(`${base}${JOURNEY_SCENE_INFO[journeyScene].asset}`);
        if (disposed || !app.stage) return;
        sceneSprites[index].texture = texture;
        fitSprite(sceneSprites[index], index);
      };

      await loadSceneTexture(sceneRef.current);
      if (disposed || !app.stage) return;
      const currentIndex = SCENE_INDEX[sceneRef.current];
      const preloadOrder = JOURNEY_SCENES
        .filter((_, index) => index !== currentIndex)
        .sort((left, right) => Math.abs(SCENE_INDEX[left] - currentIndex) - Math.abs(SCENE_INDEX[right] - currentIndex));
      void Promise.all(preloadOrder.map(loadSceneTexture));

      app.ticker.add((ticker) => {
        const deltaSeconds = ticker.deltaMS / 1000;
        elapsed += deltaSeconds;
        const targetIndex = SCENE_INDEX[sceneRef.current];
        const pointerLook = lookRef.current;
        const destinationLook = walkFocusRef.current;
        const requestedLook = walkingRef.current && destinationLook
          ? { x: destinationLook.x * 0.78 + pointerLook.x * 0.22, y: destinationLook.y * 0.72 + pointerLook.y * 0.28 }
          : pointerLook;
        const response = 1 - Math.exp(-deltaSeconds * (walkingRef.current ? 3.2 : 5.2));
        smoothedLook.x += (clamp(requestedLook.x, -1, 1) - smoothedLook.x) * response;
        smoothedLook.y += (clamp(requestedLook.y, -1, 1) - smoothedLook.y) * response;

        const profile = BREATH_PROFILE[breathRef.current];
        const breathPhase = elapsed * Math.PI * 2 * profile.frequency;
        const inhaleCurve = Math.sin(breathPhase) * 0.72 + Math.sin(breathPhase * 2 + 0.5) * 0.28;
        const breathY = inhaleCurve * profile.amplitude;
        const breathRoll = Math.sin(breathPhase + 0.8) * profile.sway;
        const stepPhase = elapsed * Math.PI * 2 * 1.72;
        const stepY = walkingRef.current ? Math.sin(stepPhase) * 3.4 + Math.abs(Math.sin(stepPhase * 0.5)) * 1.6 : 0;
        const stepX = walkingRef.current ? Math.sin(stepPhase * 0.5) * 1.25 : 0;

        sceneContainers.forEach((container, index) => {
          const targetAlpha = index === targetIndex ? 1 : 0;
          container.alpha += (targetAlpha - container.alpha) * Math.min(1, ticker.deltaTime * 0.055);
          container.visible = container.alpha > 0.005;
        });

        sceneSprites.forEach((sprite, index) => {
          const active = index === targetIndex;
          const travel = active ? progressRef.current : 0;
          const viewX = -smoothedLook.x * app.screen.width * 0.047;
          const viewY = -smoothedLook.y * app.screen.height * 0.032;
          const desiredX = app.screen.width / 2 + viewX + (active ? stepX : 0);
          const desiredY = app.screen.height / 2 + viewY + breathY + (active ? stepY + travel * 18 : 0);
          const desiredScale = (baseScales[index] ?? sprite.scale.x) * (1 + travel * 0.1);
          const desiredRotation = -smoothedLook.x * 0.0012 + breathRoll + (walkingRef.current ? Math.sin(stepPhase * 0.5) * 0.0008 : 0);
          const cameraEase = 1 - Math.exp(-deltaSeconds * 4.6);
          sprite.x += (desiredX - sprite.x) * cameraEase;
          sprite.y += (desiredY - sprite.y) * cameraEase;
          sprite.rotation += (desiredRotation - sprite.rotation) * cameraEase;
          sprite.scale.x += (desiredScale - sprite.scale.x) * cameraEase;
          sprite.scale.y = sprite.scale.x;
        });

        // Keep world-anchored DOM hotspots and props glued to the scene sprite:
        // replay the active sprite transform relative to its default framing.
        const anchorLayer = anchorLayerRef?.current;
        const activeSprite = sceneSprites[targetIndex];
        const activeBase = baseScales[targetIndex];
        if (anchorLayer && activeSprite && activeBase) {
          const offsetX = activeSprite.x - app.screen.width / 2;
          const offsetY = activeSprite.y - app.screen.height / 2;
          const relativeScale = activeSprite.scale.x / activeBase;
          anchorLayer.style.transform = `translate(${offsetX.toFixed(2)}px,${offsetY.toFixed(2)}px) rotate(${activeSprite.rotation.toFixed(4)}rad) scale(${relativeScale.toFixed(4)})`;
          if (sceneRef.current === "roadside") {
            const baseX = app.screen.width * 0.68;
            const baseY = app.screen.height * 0.60;
            const carX = app.screen.width / 2 + (baseX - app.screen.width / 2) * relativeScale + offsetX;
            const carY = app.screen.height / 2 + (baseY - app.screen.height / 2) * relativeScale + offsetY;
            const varHost = host.parentElement ?? document.documentElement;
            varHost.style.setProperty("--car-x", `${((carX / app.screen.width) * 100).toFixed(2)}%`);
            varHost.style.setProperty("--car-y", `${((carY / app.screen.height) * 100).toFixed(2)}%`);
          }
        }
      });

      onReady?.();
      return () => window.removeEventListener("resize", fit);
    };

    let cleanListeners: (() => void) | undefined;
    void boot().then((clean) => { cleanListeners = clean; });
    return () => {
      disposed = true;
      cleanListeners?.();
      if (app.renderer) app.destroy(true, { children: true });
    };
  }, [onReady]);

  return <div className="pixi-host" ref={hostRef} aria-hidden="true" />;
}
