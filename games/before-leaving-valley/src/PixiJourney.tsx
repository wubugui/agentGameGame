import { useEffect, useRef } from "react";
import { Application, Assets, Container, Graphics, Sprite } from "pixi.js";

export type JourneyScene = "arrival" | "trail" | "viewpoint";

const SCENE_INDEX: Record<JourneyScene, number> = {
  arrival: 0,
  trail: 1,
  viewpoint: 2,
};

type Props = {
  scene: JourneyScene;
  walking: boolean;
  progress?: number;
  onReady?: () => void;
};

export default function PixiJourney({ scene, walking, progress = 0, onReady }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef(scene);
  const walkingRef = useRef(walking);
  const progressRef = useRef(progress);

  useEffect(() => { sceneRef.current = scene; }, [scene]);
  useEffect(() => { walkingRef.current = walking; }, [walking]);
  useEffect(() => { progressRef.current = progress; }, [progress]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    const app = new Application();
    const sceneContainers: Container[] = [];
    const sceneSprites: Sprite[] = [];
    const baseScales: number[] = [];
    let pointerX = 0;
    let pointerY = 0;
    let elapsed = 0;

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
      const textures = await Promise.all([
        Assets.load(`${base}art/stage1-arrival-v2.webp`),
        Assets.load(`${base}art/stage1-trail.webp`),
        Assets.load(`${base}art/stage1-viewpoint.webp`),
      ]);

      textures.forEach((texture, index) => {
        const container = new Container();
        const sprite = new Sprite(texture);
        sprite.anchor.set(0.5);
        container.addChild(sprite);
        container.alpha = index === SCENE_INDEX[sceneRef.current] ? 1 : 0;
        app.stage.addChild(container);
        sceneContainers.push(container);
        sceneSprites.push(sprite);
      });

      const haze = new Graphics();
      app.stage.addChild(haze);

      const fit = () => {
        const w = app.screen.width;
        const h = app.screen.height;
        sceneSprites.forEach((sprite, index) => {
          const cover = Math.max(w / sprite.texture.width, h / sprite.texture.height) * 1.055;
          sprite.scale.set(cover);
          baseScales[index] = cover;
          sprite.position.set(w / 2, h / 2);
        });
        haze.clear().rect(0, 0, w, h).fill({ color: 0x071115, alpha: 0.05 });
      };

      fit();
      window.addEventListener("resize", fit);

      const onPointerMove = (event: PointerEvent) => {
        const rect = host.getBoundingClientRect();
        pointerX = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
        pointerY = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
      };
      host.addEventListener("pointermove", onPointerMove);

      app.ticker.add((ticker) => {
        elapsed += ticker.deltaMS / 1000;
        const target = SCENE_INDEX[sceneRef.current];
        const bob = walkingRef.current ? Math.sin(elapsed * 9) * 5 : Math.sin(elapsed * 0.65) * 1.2;
        sceneContainers.forEach((container, index) => {
          const targetAlpha = index === target ? 1 : 0;
          container.alpha += (targetAlpha - container.alpha) * Math.min(1, ticker.deltaTime * 0.055);
          container.visible = container.alpha > 0.005;
        });
        sceneSprites.forEach((sprite, index) => {
          const depth = index === 1 ? 17 : 12;
          const desiredX = app.screen.width / 2 - pointerX * depth;
          const travel = index === target ? progressRef.current : 0;
          const desiredY = app.screen.height / 2 - pointerY * 8 + (index === target ? bob + travel * 22 : 0);
          const desiredScale = (baseScales[index] ?? sprite.scale.x) * (1 + travel * 0.085);
          sprite.x += (desiredX - sprite.x) * 0.045;
          sprite.y += (desiredY - sprite.y) * 0.045;
          sprite.scale.x += (desiredScale - sprite.scale.x) * 0.045;
          sprite.scale.y = sprite.scale.x;
        });
      });

      onReady?.();
      return () => {
        window.removeEventListener("resize", fit);
        host.removeEventListener("pointermove", onPointerMove);
      };
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
