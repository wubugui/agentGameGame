/* The pack, spread on a cloth on the ground. Worn things, things to use, things brought back. */
import { HANDHELD_ORDER, ITEMS, WEARABLE_ORDER } from "../../data/items";
import type { ItemId } from "../../engine/types";
import { useWorldContext, useWorldValue } from "../useWorld";

export function PackCloth() {
  const world = useWorldContext();
  const inventory = useWorldValue((s) => s.inventory);
  const lost = useWorldValue((s) => Boolean(s.flags["phone.lost"]));
  const lampMode = useWorldValue((s) => s.power.lampMode);
  const has = (item: ItemId) => inventory.items.includes(item);
  const worn = (item: ItemId) => inventory.worn.includes(item);
  const held = (item: ItemId) => inventory.hands.includes(item);
  const dirt = inventory.packDirt;
  const use = (item: ItemId) => world.dispatch({ type: "item:use", item });

  return (
    <div className="paper-overlay pack-overlay" role="dialog" aria-modal="true" aria-label="背包" onPointerDown={(event) => { if (event.target === event.currentTarget) world.dispatch({ type: "pack:close" }); }}>
      <div className={`pack-cloth dirt-${dirt}`}>
        <section className="pack-row pack-worn">
          <small>身上</small>
          {WEARABLE_ORDER.map((item) => {
            const def = ITEMS[item];
            const owned = has(item);
            return (
              <button key={item} className={`pack-item ${owned ? "" : "gone"} ${worn(item) ? "worn" : ""}`} disabled={!owned} onClick={() => world.dispatch(worn(item) ? { type: "pack:stow", item } : { type: "pack:equip", item })} aria-label={def.name}>
                <img src={`${import.meta.env.BASE_URL}${def.sprite}`} alt="" draggable={false} />
                <span>{def.name}</span>
                <em>{owned ? (worn(item) ? "穿着" : "放在包里") : "不在了"}</em>
              </button>
            );
          })}
        </section>
        <section className="pack-row pack-hand">
          <small>要用的</small>
          {HANDHELD_ORDER.map((item) => {
            const def = ITEMS[item];
            const owned = has(item) && !(item === "phone" && lost);
            const missing = item === "phone" && lost;
            return (
              <div key={item} className={`pack-item ${owned ? "" : "gone"} ${held(item) ? "held" : ""} ${missing ? "missing" : ""}`}>
                {owned && <img src={`${import.meta.env.BASE_URL}${def.sprite}`} alt="" draggable={false} />}
                {!owned && <i className="pack-outline" />}
                <span>{def.name}</span>
                {owned && item !== "letterPhoto" && <button className="pack-use" onClick={() => use(item)}>{item === "paperMap" || item === "notebook" ? "摊开" : item === "chocolate" ? "吃" : item === "fillLight" ? (lampMode ? "换咬法" : "拿出来") : item === "phone" ? "拿出来" : item === "camera360" ? "举起来" : "拿在手里"}</button>}
                {owned && item === "fillLight" && lampMode && <div className="lamp-modes"><button className={lampMode === "wide" ? "on" : ""} onClick={() => world.dispatch({ type: "lamp:mode", mode: "wide" })}>宽光</button><button className={lampMode === "narrow" ? "on" : ""} onClick={() => world.dispatch({ type: "lamp:mode", mode: "narrow" })}>窄光</button></div>}
                {missing && <em>口袋是空的</em>}
              </div>
            );
          })}
        </section>
        <button className="pack-close" onClick={() => world.dispatch({ type: "pack:close" })}>收起</button>
      </div>
    </div>
  );
}
