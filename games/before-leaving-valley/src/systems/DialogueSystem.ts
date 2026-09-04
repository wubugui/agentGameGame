/* One line at a time, never queued past the next, player lines pre-empt the fallback, silence is the default. */
import { checkLine } from "../engine/policy";
import { SCENES } from "../engine/scene";
import type { System } from "../engine/world";

type Line = { text: string; priority: number; tag?: string; at: number };
const FALLBACK_MAX = 3;

export const DialogueSystem: System = {
  id: "dialogue", order: 200,
  init(world) {
    const offs: Array<() => void> = [];
    let pending: Line | null = null;
    let lastShownAt = -Infinity;
    let acted = false;
    let key = 0;
    const duration = (text: string) => Math.min(6500, 2200 + text.replace(/[\s，。！？、“”…—·]/g, "").length * 140);
    const show = (line: Line) => {
      key += 1;
      lastShownAt = world.rt.now;
      world.patch("ui", { line: { text: line.text, until: world.rt.now + duration(line.text), key } });
    };
    offs.push(world.on("say", ({ line, priority = 0, delay = 0, tag }) => {
      if (!line) return;
      checkLine(line);
      if (world.state.body.adrenaline && priority < 2) return;                 // she no longer speaks
      const current = world.state.ui.line;
      if (tag && (current?.text === line || pending?.tag === tag)) return;
      const next: Line = { text: line, priority, tag, at: world.rt.now + delay };
      if (delay > 0) { if (!pending || priority >= pending.priority) pending = next; return; }
      if (current && world.rt.now < current.until && priority <= 0 && world.rt.now - lastShownAt < 6000) { pending = next; return; }
      pending = null;
      show(next);
    }));
    offs.push(world.on("flash", ({ text }) => { key += 1; world.patch("ui", { flash: { text, until: world.rt.now + 1800, key } }); }));
    offs.push(world.on("scene:exit", () => { pending = null; world.patch("ui", { line: null, flash: null }); }));
    offs.push(world.on("interact:attempt", () => { acted = true; if (pending?.tag === "fallback") pending = null; }));
    offs.push(world.on("hold:complete", () => { acted = true; }));
    offs.push(world.on("body:adrenaline", ({ on }) => { if (on) { pending = null; world.patch("ui", { line: null }); } }));
    // The fallback: her arrival line only if the player does nothing for 2 s after arriving, at most three times a game.
    offs.push(world.on("scene:enter", ({ scene, warped }) => {
      acted = false;
      const def = SCENES[scene];
      if (!def?.fallback || warped || world.state.stats.fallbackLines >= FALLBACK_MAX) return;
      const wait = def.chapter ? 4600 + 2000 : 2000;
      world.after(wait, () => {
        if (acted || world.state.sceneId !== scene || world.state.ui.overlay || world.state.ui.phoneOpen) return;
        world.patch("stats", { fallbackLines: world.state.stats.fallbackLines + 1 });
        world.emit("say", { line: def.fallback!, tag: "fallback", priority: -1 });
      });
      if (def.chapter) world.patch("ui", { chapter: { ...def.chapter, until: world.rt.now + 4600 } });
    }));
    return () => offs.forEach((off) => off());
  },
  tick(world) {
    const ui = world.state.ui;
    if (pendingDue(world.rt.now)) { /* handled below */ }
    if (ui.line && world.rt.now >= ui.line.until) world.patch("ui", { line: null });
    if (ui.flash && world.rt.now >= ui.flash.until) world.patch("ui", { flash: null });
    if (ui.chapter && world.rt.now >= ui.chapter.until) world.patch("ui", { chapter: null });
  },
};

const pendingDue = (_now: number) => false;
