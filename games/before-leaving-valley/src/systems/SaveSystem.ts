/* Save on scene entry, phase change, and after 2 s of stillness. Never mid-transition, never after the letter. */
import { writeSave } from "../engine/save";
import type { System } from "../engine/world";

export const SaveSystem: System = {
  id: "save", order: 100,
  init(world) {
    const offs: Array<() => void> = [];
    const write = () => {
      if (world.rt.noSave || world.rt.headless || world.state.phase !== "play" || world.state.ui.travel) return;
      if (world.flag("bench.translated", false)) return;
      if (writeSave(world.state)) world.emit("save:written", { scene: world.state.sceneId });
    };
    offs.push(world.on("scene:enter", () => world.after(50, write)));
    offs.push(world.on("interact:done", () => { world.rt.log.push("save-dirty"); dirty = true; }));
    offs.push(world.on("clock:advance", () => { dirty = true; }));
    let dirty = false;
    let still = 0;
    offs.push(world.on("flow:phase", ({ phase }) => { if (phase === "play") world.after(50, write); }));
    return () => offs.forEach((off) => off());
    function unused() { return still; }
    void unused;
  },
  tick(world, dt) {
    const rt = world.rt as typeof world.rt & { saveStill?: number; saveDirty?: boolean };
    rt.saveStill = (rt.saveStill ?? 0) + dt;
    if (world.rt.gazeMoved) rt.saveStill = 0;
    if (rt.saveStill > 2 && world.state.phase === "play" && !world.state.ui.travel && !world.rt.noSave && !world.rt.headless && !world.flag("bench.translated", false)) {
      if (rt.saveDirty !== false) { writeSave(world.state); rt.saveDirty = false; }
    }
    if (world.rt.gazeMoved) rt.saveDirty = true;
  },
};
