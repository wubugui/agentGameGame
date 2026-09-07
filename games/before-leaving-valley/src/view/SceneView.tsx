/* The painting, the entities on it, and the body layers. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PanoStage, { type BodyMode as StageBodyMode, type BreathState } from "../PanoStage";
import { lightOf } from "../engine/condition";
import type { EntityView } from "../engine/entity";
import { buildViews } from "../engine/registry";
import { SCENES } from "../engine/scene";
import type { StageHandle } from "../engine/world";
import { HandsLayer } from "./HandsLayer";
import { Hotspot } from "./Hotspot";
import { PropSprite } from "./PropSprite";
import { useWorldContext, useWorldValue } from "./useWorld";

const sameViews = (a: EntityView[], b: EntityView[]) => a.length === b.length && a.every((view, index) => {
  const other = b[index];
  return view.id === other.id && view.disabled === other.disabled && view.sprite?.src === other.sprite?.src && view.sprite?.className === other.sprite?.className && view.transform.yaw === other.transform.yaw && view.transform.pitch === other.transform.pitch && view.label === other.label;
});

export function SceneView() {
  const world = useWorldContext();
  const sceneId = useWorldValue((s) => s.sceneId);
  const scene = SCENES[sceneId];
  const views = useWorldValue((_, w) => buildViews(w), sameViews);
  const light = useWorldValue((s) => Math.round(lightOf(s) * 40) / 40);
  const interior = scene?.interior ?? false;
  const travel = useWorldValue((s) => s.ui.travel);
  const breath = useWorldValue((s) => s.body.breath) as BreathState;
  const fear = useWorldValue((s) => s.body.fear);
  const fatigue = useWorldValue((s) => s.body.fatigue);
  const motion = useWorldValue((s) => s.settings.motion);
  const idle = useWorldValue((s) => Boolean(SCENES[s.sceneId]?.idleLook) && !s.ui.overlay && !s.ui.phoneOpen && !s.ui.menuOpen && !s.ui.travel);
  const anchorLayer = useRef<HTMLDivElement>(null);
  const stageRef = useRef<StageHandle | null>(null);
  const progressRef = useRef(0);
  const [look, setLook] = useState({ x: 0, y: 0 });

  useEffect(() => { world.rt.stage = stageRef.current; });
  useEffect(() => { const timer = window.setInterval(() => { world.rt.stage = stageRef.current; }, 500); return () => window.clearInterval(timer); }, [world]);

  // The renderer reports the gaze; the engine loop in boot.ts does the ticking.
  const onFrame = useCallback((_dt: number, gaze: { yaw: number; pitch: number }) => {
    world.rt.gaze = gaze;
    if (world.state.ui.travel) progressRef.current = Math.min(1, (performance.now() - world.state.ui.travel.started) / world.state.ui.travel.ms);
    else progressRef.current = 0;
  }, [world]);

  const worldMove = (event: React.PointerEvent) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const next = { x: ((event.clientX - rect.left) / rect.width - 0.5) * 2, y: ((event.clientY - rect.top) / rect.height - 0.5) * 2 };
    world.rt.look = next;
    setLook(next);
  };

  const bodyMode: StageBodyMode = travel ? (travel.run ? "run" : "walk") : (scene?.body ?? "stand");
  const tension = scene?.body === "crawl" || scene?.body === "climb" ? Math.max(fear, fatigue * 0.6) : 0;
  const lightProp = interior ? ("interior" as const) : light;
  const props = useMemo(() => views.filter((view) => view.kind === "prop"), [views]);
  const hotspots = useMemo(() => views.filter((view) => view.kind !== "prop"), [views]);

  return (
    <>
      <PanoStage asset={scene?.painting ?? "pano/01-meadow.webp"} light={lightProp} look={look} walking={Boolean(travel)} progress={0} progressRef={progressRef} breath={breath} mode={bodyMode} tension={tension} handleRef={stageRef} idle={idle} anchorLayerRef={anchorLayer} reduceMotion={!motion} onFrame={onFrame} />
      <div className="world-input" onPointerMove={worldMove}>
        <span className="gaze-dot" style={{ left: `${(look.x + 1) * 50}%`, top: `${(look.y + 1) * 50}%` }} />
      </div>
      <div className="anchor-layer" ref={anchorLayer}>
        {props.map((view) => <PropSprite key={view.id} view={view} />)}
        {hotspots.map((view) => <Hotspot key={view.id} view={view} />)}
        <HandsLayer.Reach />
      </div>
      <HandsLayer.Body walking={Boolean(travel)} running={Boolean(travel?.run)} />
    </>
  );
}
