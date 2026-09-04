/* One interactive entity on the painting. Registers its node with the world so GazeSystem can set the live reveal radius. */
import { useEffect, useRef } from "react";
import type { EntityView } from "../engine/entity";
import type { Verb } from "../engine/types";
import { useWorldContext } from "./useWorld";

export function Hotspot({ view }: { view: EntityView }) {
  const world = useWorldContext();
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    world.rt.nodes.set(view.id, node);
    return () => { if (world.rt.nodes.get(view.id) === node) world.rt.nodes.delete(view.id); };
  }, [view.id, world]);

  const isHold = view.kind === "hold";
  const isExit = view.kind === "exit";
  const verb: Verb = isHold ? "hold" : view.verbs?.[0] ?? "inspect";
  const act = () => {
    if (view.disabled) return;
    if (isExit) world.dispatch({ type: "travel", entity: view.id });
    else world.dispatch({ type: "interact", entity: view.id, verb });
  };
  const className = `hotspot ${isExit ? "go-hotspot" : ""} ${isHold ? "climb-hotspot" : ""} ${view.kind === "blaze" ? "blaze-hotspot" : ""} ${view.className ?? ""} ${view.disabled ? "is-disabled" : ""}`;
  const holdHandlers = isHold ? {
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => { event.stopPropagation(); try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* synthetic */ } world.dispatch({ type: "hold:start", entity: view.id }); },
    onPointerUp: () => world.dispatch({ type: "hold:end" }),
    onPointerCancel: () => world.dispatch({ type: "hold:end" }),
    onPointerLeave: () => world.dispatch({ type: "hold:end" }),
    onKeyDown: (event: React.KeyboardEvent) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); world.dispatch({ type: "hold:start", entity: view.id }); } },
    onKeyUp: (event: React.KeyboardEvent) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); world.dispatch({ type: "hold:end" }); } },
  } : {
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => { event.stopPropagation(); act(); },
    onClick: (event: React.MouseEvent) => { if (event.detail === 0) act(); },
  };
  return (
    <button ref={ref} className={className} data-yaw={view.transform.yaw} data-pitch={view.transform.pitch} data-distance={view.transform.distance ?? 10} data-reveal={view.reveal || 0} data-entity={view.id} aria-label={view.label} {...holdHandlers}>
      {view.sprite && <img className="hotspot-sprite" src={`${import.meta.env.BASE_URL}${view.sprite.src}`} alt="" draggable={false} onError={(event) => { event.currentTarget.style.visibility = "hidden"; }} style={view.sprite.sizeVh ? { height: `${view.sprite.sizeVh * (view.transform.distance ?? 10) / 10}vh` } : undefined} />}
      <span />
      {view.label && <em>{view.label}{view.keyHint ? ` · ${view.keyHint}` : ""}</em>}
    </button>
  );
}
