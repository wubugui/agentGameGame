/* The notebook is the back of the paper map. Every entry comes from something read in the world. */
import { ENTRIES } from "../data/entries";
import type { System } from "../engine/world";

export const JournalSystem: System = {
  id: "journal", order: 80,
  init(world) {
    const offs: Array<() => void> = [];
    offs.push(world.on("journal:entry", ({ entry }) => {
      if (!ENTRIES[entry]) { if (import.meta.env.DEV) console.warn("[journal] unknown entry", entry); return; }
      if (world.state.journal.entries.includes(entry)) return;
      world.patch("journal", { entries: [...world.state.journal.entries, entry] });
      world.emit("sfx", { name: "pencil" });
      // Reading the trail board gives the legs' hours for the map.
      const legs = ENTRIES[entry].mapLegs;
      if (legs) world.patch("journal", { mapLegs: { ...world.state.journal.mapLegs, ...legs } });
    }));
    offs.push(world.on("blaze:confirm", ({ entity, real }) => {
      if (real) {
        world.patch("stats", { blazesFound: world.state.stats.blazesFound + 1 });
        world.setFlag(`${world.state.sceneId}.certain`, true);
        world.emit("hand:reach", { transform: world.rt.views.get(entity)?.transform ?? { yaw: 0, pitch: 0 }, kind: "grip", hold: false });
        world.emit("sfx", { name: "cloth" });
        if (!world.state.journal.blazesLearned) { world.patch("journal", { blazesLearned: true }); world.emit("say", { line: "红白红。跟着这个走。", tag: "blaze-learn", priority: 1 }); }
        if (["forestEdge", "forest1", "forest2"].includes(world.state.sceneId)) world.emit("body:fear", { delta: -0.25, reason: "656" });
      } else {
        world.patch("stats", { blazesMissed: world.state.stats.blazesMissed + 1 });
        world.emit("clock:advance", { minutes: 1, reason: "认错记号" });
        world.emit("sfx", { name: "tock" });
      }
    }));
    offs.push(world.handle("ui:action", ({ id, value }) => {
      if (id.startsWith("map:leg:")) {
        const leg = id.slice("map:leg:".length);
        const hours = typeof value === "number" ? value : Number(value ?? 0);
        world.patch("journal", { mapLegs: { ...world.state.journal.mapLegs, [leg]: hours } });
        world.emit("sfx", { name: "pencil" });
        world.setFlag("map.legsChecked", Object.keys(world.state.journal.mapLegs).length);
      }
      if (id === "map:objective" && typeof value === "string") { world.patch("journal", { objective: value }); world.emit("journal:objective", { text: value }); world.emit("sfx", { name: "pencil" }); }
      world.emit("ui:action", { id, value });
    }));
    return () => offs.forEach((off) => off());
  },
};
