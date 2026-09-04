/* The pack is a cloth on the ground. Wearing, holding, using. */
import { ITEMS } from "../data/items";
import type { System } from "../engine/world";
import type { ItemId } from "../engine/types";

const WEARABLE = new Set<ItemId>(["helmet", "lanyard", "gloves", "cap", "redJacket", "backpack"]);
const HANDHELD = new Set<ItemId>(["camera360", "phone", "fillLight", "paperMap", "pencil", "chocolate", "notebook", "contactCard"]);

export const InventorySystem: System = {
  id: "inventory", order: 70,
  init(world) {
    const offs: Array<() => void> = [];
    const inv = () => world.state.inventory;
    offs.push(world.on("item:gain", ({ item }) => {
      if (inv().items.includes(item)) return;
      world.patch("inventory", { items: [...inv().items, item] });
      world.emit("sfx", { name: "cloth" });
    }));
    offs.push(world.on("item:lose", ({ item }) => {
      world.patch("inventory", { items: inv().items.filter((i) => i !== item), worn: inv().worn.filter((i) => i !== item), hands: inv().hands.filter((i) => i !== item) });
      if (item === "phone") { world.setFlag("phone.lost", true); world.setFlag("phone.lostAt", world.state.clock.minuteOfDay); world.emit("phone:lost", { minute: world.state.clock.minuteOfDay }); }
    }));
    offs.push(world.handle("pack:open", () => {
      if (world.state.ui.overlay) return;
      world.patch("ui", { overlay: "pack", overlayData: {} });
      world.emit("clock:advance", { minutes: 0.5, reason: "摊开背包" });
      world.emit("sfx", { name: "zip" });
    }));
    offs.push(world.handle("pack:close", () => {
      if (world.state.ui.overlay !== "pack") return;
      world.patch("ui", { overlay: null });
      world.emit("clock:advance", { minutes: 0.5, reason: "收起背包" });
      world.emit("sfx", { name: "zip" });
    }));
    offs.push(world.handle("pack:equip", ({ item }) => {
      if (!inv().items.includes(item)) return;
      if (WEARABLE.has(item)) {
        if (inv().worn.includes(item)) return;
        // Order of dressing at the ferrata start: helmet before lanyard (v4 §3.6). Her hand comes back otherwise.
        if (item === "lanyard" && !inv().worn.includes("helmet")) { world.emit("sfx", { name: "tock" }); return; }
        world.patch("inventory", { worn: [...inv().worn, item] });
        world.emit("item:equip", { item });
        world.emit("sfx", { name: item === "lanyard" ? "clink" : "cloth" });
        world.emit("clock:advance", { minutes: 1, reason: `穿上 ${ITEMS[item].name}` });
      } else if (HANDHELD.has(item)) {
        if (inv().hands.includes(item)) return;
        const hands = [...inv().hands, item].slice(-2);
        world.patch("inventory", { hands });
        world.emit("item:equip", { item });
        world.emit("sfx", { name: "cloth" });
      }
    }));
    offs.push(world.handle("pack:stow", ({ item }) => {
      world.patch("inventory", { worn: inv().worn.filter((i) => i !== item), hands: inv().hands.filter((i) => i !== item) });
      world.emit("item:stow", { item });
      world.emit("sfx", { name: "cloth" });
    }));
    offs.push(world.handle("item:use", ({ item }) => {
      if (!inv().items.includes(item)) return;
      if (item === "chocolate") {
        world.patch("inventory", { items: inv().items.filter((i) => i !== item), hands: inv().hands.filter((i) => i !== item) });
        world.emit("clock:advance", { minutes: 3, reason: "吃巧克力" });
        world.emit("sfx", { name: "paper" });
        world.emit("item:use", { item });
        world.setFlag("chocolate.eatenAt", world.state.sceneId);
        return;
      }
      if (item === "fillLight") {
        if (!inv().hands.includes("fillLight")) world.patch("inventory", { hands: ([...inv().hands.filter((i) => i !== "paperMap"), "fillLight"] as ItemId[]).slice(-2) });
        if (!world.state.power.lampMode) world.patch("power", { lampMode: "wide" });
        world.emit("item:use", { item });
        world.emit("fx", { name: "flashlight" });
        return;
      }
      if (item === "paperMap") {
        world.patch("ui", { overlay: "paperMap", overlayData: {} });
        world.emit("clock:advance", { minutes: 0.3, reason: "摊开地图" });
        world.emit("sfx", { name: "paper" });
        world.emit("item:use", { item });
        return;
      }
      if (item === "notebook") { world.patch("ui", { overlay: "paperMap", overlayData: { page: "notes" } }); world.emit("item:use", { item }); return; }
      world.emit("item:use", { item });
    }));
    offs.push(world.handle("lamp:mode", ({ mode }) => {
      if (world.state.power.lampMode === mode) return;
      world.emit("lamp:mode", { mode });
      world.emit("clock:advance", { minutes: 0.3, reason: "换一种咬法" });
    }));
    // The cloth gets dirty as the day goes on.
    offs.push(world.on("scene:enter", ({ scene }) => {
      const dirt = ["scree", "deer"].includes(scene) ? 1 : ["forestEdge", "forest1", "forest2", "hairpin", "car", "search", "searchWall", "searchPath", "hotel"].includes(scene) ? 2 : ["busStop", "police", "bench"].includes(scene) ? 0 : null;
      if (dirt !== null && dirt !== world.state.inventory.packDirt) world.patch("inventory", { packDirt: dirt as 0 | 1 | 2 | 3 });
    }));
    return () => offs.forEach((off) => off());
  },
};
