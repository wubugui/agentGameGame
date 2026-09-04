/* Story actions are entities with the `action` tag; they render as E-key prompts. Forest voices too. */
import { useEffect } from "react";
import { SCENES } from "../engine/scene";
import { useWorldContext, useWorldValue } from "./useWorld";

export function Actions() {
  const world = useWorldContext();
  const sceneId = useWorldValue((s) => s.sceneId);
  const forest = sceneId === "forest1" || sceneId === "forest2" || sceneId === "forestEdge";
  const overlay = useWorldValue((s) => s.ui.overlay);
  const phoneOpen = useWorldValue((s) => s.ui.phoneOpen);
  const menuOpen = useWorldValue((s) => s.ui.menuOpen);
  const growlable = sceneId === "forest1" || sceneId === "forest2";

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (world.state.phase !== "play") return;
      const key = event.key.toLowerCase();
      if (event.target instanceof HTMLInputElement) return;
      if (key === "p" && !menuOpen) { event.preventDefault(); world.dispatch(world.state.ui.phoneOpen ? { type: "phone:close" } : { type: "phone:open" }); }
      if (key === "i" && !menuOpen && !phoneOpen) { event.preventDefault(); world.dispatch(world.state.ui.overlay === "pack" ? { type: "pack:close" } : { type: "pack:open" }); }
      if (key === "escape") {
        if (world.state.ui.phoneOpen) world.dispatch({ type: "phone:close" });
        else if (world.state.ui.overlay === "pack") world.dispatch({ type: "pack:close" });
        else if (world.state.ui.overlay && world.state.ui.overlay !== "call" && world.state.ui.overlay !== "selfie") world.dispatch({ type: "overlay:close" });
        else world.dispatch({ type: "menu", open: !world.state.ui.menuOpen });
      }
      if (event.code === "Space" && forest && !phoneOpen && !overlay && !(event.target instanceof HTMLButtonElement)) {
        event.preventDefault();
        if (growlable && !event.repeat) world.dispatch({ type: "growl:start" });
        if (!growlable) world.dispatch({ type: "shout" });
      }
      if (key === "e" && !phoneOpen && !menuOpen && !overlay) {
        const action = document.querySelector<HTMLButtonElement>(".story-action");
        if (action) { event.preventDefault(); action.click(); }
      }
    };
    const up = (event: KeyboardEvent) => { if (event.code === "Space" && growlable) world.dispatch({ type: "growl:end" }); };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [world, forest, growlable, menuOpen, phoneOpen, overlay]);

  const scene = SCENES[sceneId];
  const actionIds = useWorldValue((s, w) => (SCENES[s.sceneId]?.entities ?? []).filter((e) => e.tags?.includes("action") && (!e.visible || w.state && require_(w, e))).map((e) => e.id), (a, b) => a.length === b.length && a.every((v, i) => v === b[i]));
  if (!scene) return null;
  return (
    <>
      {actionIds.map((id) => {
        const def = scene.entities.find((e) => e.id === id)!;
        return <button key={id} className={`story-action ${def.className ?? ""}`} onPointerDown={(event) => { event.stopPropagation(); world.dispatch({ type: "interact", entity: id, verb: def.interactable?.verbs[0] ?? "talk" }); }} onClick={(event) => { if (event.detail === 0) world.dispatch({ type: "interact", entity: id, verb: def.interactable?.verbs[0] ?? "talk" }); }}>{def.interactable?.label}</button>;
      })}
      {growlable && <button className="story-action shout-action" onPointerDown={(event) => { event.stopPropagation(); world.dispatch({ type: "shout" }); }}>喊一声</button>}
    </>
  );
}

import { testCondition } from "../engine/condition";
import type { EntityDef } from "../engine/entity";
import type { World } from "../engine/world";
const require_ = (w: World, e: EntityDef) => testCondition(w.state, e.visible);
