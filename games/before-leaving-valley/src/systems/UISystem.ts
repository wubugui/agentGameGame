/* Overlays, phone, menu, flow and the two forest voices. */
import { createInitialPhoneState, phoneReducer, type PhoneAction } from "../phoneModel";
import { saveSettings } from "../settings";
import { clearSave } from "../engine/save";
import { enterScene } from "../engine/registry";
import { createInitialState } from "../engine/world";
import type { System, World } from "../engine/world";
import { SCENES } from "../engine/scene";

export function phoneDispatch(world: World, action: PhoneAction) {
  world.set("phone", phoneReducer(world.state.phone, action));
  if (action.type === "capture_photo") { world.patch("stats", { photos: world.state.stats.photos + 1 }); world.emit("phone:photo", { scene: world.state.sceneId, kind: action.photo.kind === "letter" ? "letter" : undefined }); }
  if (action.type === "receive_message") world.emit("phone:message", { contact: action.contactId, text: action.text });
}

export const UISystem: System = {
  id: "ui", order: 15,
  init(world) {
    const offs: Array<() => void> = [];
    offs.push(world.handle("overlay:open", ({ id, data }) => { world.patch("ui", { overlay: id, overlayData: data ?? {} }); world.emit("overlay", { id }); }));
    offs.push(world.handle("overlay:close", () => { if (!world.state.ui.overlay) return; world.patch("ui", { overlay: null, reading: null }); world.emit("overlay", { id: null }); }));
    offs.push(world.handle("phone:open", ({ tab }) => {
      if (world.flag("phone.lost", false)) { world.emit("camera:impulse", { kind: "glance", strength: 0.6, dir: { yaw: 0, pitch: -6 } }); world.emit("sfx", { name: "cloth" }); return; }
      world.patch("ui", { phoneOpen: true, phoneTab: tab ?? "home" });
      world.patch("camera", { aimX: 50 + world.rt.look.x * 34, aimY: 50 + world.rt.look.y * 28 });
      world.emit("phone:open", { tab: tab ?? "home" });
      world.emit("sfx", { name: "tick" });
    }));
    offs.push(world.handle("phone:close", () => { if (!world.state.ui.phoneOpen) return; world.patch("ui", { phoneOpen: false }); world.emit("phone:close", {}); world.emit("sfx", { name: "tock" }); }));
    offs.push(world.handle("phone:shoot", ({ snapshot }) => {
      const scene = SCENES[world.state.sceneId];
      phoneDispatch(world, { type: "capture_photo", photo: { asset: scene.painting, snapshot, title: scene.place, place: scene.place, position: { x: world.state.camera.aimX, y: world.state.camera.aimY }, zoom: world.state.camera.zoom, day: scene.day } });
      world.emit("sfx", { name: "shutter" });
      world.emit("clock:advance", { minutes: 1, reason: "拍照" });
      world.emit("power:drain", { source: "phone", value: 1, reason: "拍照" });
    }));
    offs.push(world.handle("phone:send", ({ contact, text, photoId, kind }) => {
      if (photoId) phoneDispatch(world, { type: "send_photo", contactId: contact, photoId, text });
      else if (text) phoneDispatch(world, { type: "send_message", contactId: contact, text });
      const replyKind = kind ?? (photoId ? "photo" : "text");
      world.setFlag(`summit.sent.${contact}`, true);
      phoneDispatch(world, { type: "set_typing", contactId: contact, value: true });
      const reply = REPLIES[contact][replyKind];
      world.after(replyKind === "photo" ? 1850 : 1350, () => { phoneDispatch(world, { type: "set_typing", contactId: contact, value: false }); phoneDispatch(world, { type: "receive_message", contactId: contact, text: reply }); });
    }));
    offs.push(world.handle("menu", ({ open }) => { world.patch("ui", { menuOpen: open }); }));
    offs.push(world.handle("settings", ({ patch }) => { const next = { ...world.state.settings, ...patch }; saveSettings(next); world.set("settings", next); }));
    offs.push(world.handle("ui:action", ({ id, value }) => {
      if (id === "phone:tab" && value === "conversation" && !world.state.journal.entries.includes("E-coach")) world.emit("journal:entry", { entry: "E-coach", source: null });
      world.emit("ui:action", { id, value });
    }));
    offs.push(world.handle("shout", () => {
      if (!["scree", "signpost", "deer", "forestEdge", "forest1", "forest2"].includes(world.state.sceneId)) return;
      if (world.rt.now - Number(world.flag("shout.at", -99999)) < 4000) return;
      world.setFlag("shout.at", world.rt.now);
      world.setFlag(`${world.state.sceneId}.shouted`, true);
      world.emit("body:fear", { delta: -0.4 * (world.state.journal.entries.includes("E-forest") ? 1.3 : 1) });
      world.emit("body:fatigue", { delta: 0.02 });
      world.emit("camera:impulse", { kind: "shout", strength: 1 });
      world.emit("sfx", { name: "breath", strength: 1.4 });
      world.emit("fx", { name: "shout" });
    }));
    offs.push(world.handle("growl:start", () => { world.rt.growling = true; if (world.rt.hold) world.dispatch({ type: "hold:end" }); }));
    offs.push(world.handle("growl:end", () => { world.rt.growling = false; }));
    offs.push(world.handle("flow", ({ action }) => {
      if (action === "begin") {
        clearSave();
        const fresh = createInitialState(world.state.settings, createInitialPhoneState());
        for (const key of Object.keys(fresh) as Array<keyof typeof fresh>) world.set(key, fresh[key]);
        world.set("phase", "play");
        world.emit("flow:phase", { phase: "play" });
        enterScene(world, "roadside", { from: null });
      } else if (action === "continue") {
        world.set("phase", "play");
        world.emit("flow:phase", { phase: "play" });
        enterScene(world, world.state.sceneId, { from: world.state.previousSceneId });
      } else if (action === "title") {
        world.rt.sceneUnsubs.forEach((off) => off()); world.rt.sceneUnsubs = [];
        world.patch("ui", { overlay: null, phoneOpen: false, menuOpen: false, travel: null, line: null });
        world.set("phase", "title");
        world.emit("flow:phase", { phase: "title" });
      } else if (action === "complete") {
        world.patch("ui", { creditLine: 0, phoneOpen: false, overlay: null });
        world.set("phase", "complete");
        world.emit("flow:phase", { phase: "complete" });
        world.emit("ending:begin", {});
        clearSave();
      } else if (action === "credits:skip") {
        world.patch("ui", { creditLine: 99 });
      }
    }));
    // Growling holds the fear down while it lasts, but takes the hand.
    return () => offs.forEach((off) => off());
  },
  tick(world, dt) {
    if (world.rt.growling && ["forest1", "forest2"].includes(world.state.sceneId)) world.emit("body:fear", { delta: -0.05 * dt });
  },
};

const REPLIES = {
  xiaoyu: { text: "收到。慢慢走，别赶。", photo: "这也太好看了。原图留好。" },
  mama: { text: "好。到了发个消息。", photo: "真漂亮。你爸问是哪座山。" },
  asha: { text: "等你回来一起画。", photo: "这一张，什么都不用改了。" },
} as const;
