/* The Tabacco map, spread on a rock. Drag a finger along a leg to add its hours; the notebook is the back. */
import { useState } from "react";
import { ENTRIES } from "../../data/entries";
import { HOURS_ALREADY, HUT_LEG, MAP_LEGS, SUNSET_LABEL } from "../../data/map";
import { formatGameTime } from "../../phoneModel";
import { useWorldContext, useWorldValue } from "../useWorld";

export function PaperMap() {
  const world = useWorldContext();
  const journal = useWorldValue((s) => s.journal);
  const sceneId = useWorldValue((s) => s.sceneId);
  const minute = useWorldValue((s) => s.clock.minuteOfDay);
  const night = useWorldValue((s) => s.clock.day === 1 && s.clock.minuteOfDay >= s.clock.sunsetMinute);
  const page = useWorldValue((s) => s.ui.overlayData.page === "notes" ? "notes" : "map");
  const [side, setSide] = useState<"map" | "notes">(page);
  const knowsTimes = journal.entries.includes("E-route");
  const knowsHut = journal.entries.includes("E-hutTime");
  const checked = journal.mapLegs;
  const total = MAP_LEGS.reduce((sum, leg) => sum + (checked[leg.id] ?? 0), 0);
  const allChecked = MAP_LEGS.every((leg) => checked[leg.id] !== undefined);
  const decision = sceneId === "hutView" || sceneId === "hutTurn";
  const sunsetLeft = Math.max(0, (20 * 60 + 15 - minute) / 60);

  const check = (id: string, hours: number) => world.dispatch({ type: "ui:action", id: `map:leg:${id}`, value: hours });

  return (
    <div className={`paper-overlay map-overlay ${night ? "by-lamp" : ""}`} role="dialog" aria-modal="true" aria-label="纸地图" onPointerDown={(event) => { if (event.target === event.currentTarget) world.dispatch({ type: "overlay:close" }); }}>
      <div className={`paper-map side-${side}`}>
        {side === "map" ? (
          <div className="map-face">
            <header><strong>TABACCO 05 · Gruppo del Sella</strong><span>1:25 000</span></header>
            <div className="map-sheet-art" />
            <ul className="map-legs">
              {MAP_LEGS.map((leg) => {
                const known = knowsTimes ? leg.hours : checked[leg.id];
                return (
                  <li key={leg.id} className={checked[leg.id] !== undefined ? "checked" : ""}>
                    <span className="leg-name">{leg.name}</span>
                    {knowsTimes ? <button className="leg-hours" onClick={() => check(leg.id, leg.hours)}>{leg.hours} h</button>
                      : <span className="leg-estimate"><input type="range" min={0.5} max={3} step={0.5} value={checked[leg.id] ?? 1} onChange={(event) => check(leg.id, Number(event.target.value))} aria-label={`${leg.name} 估计小时`} /><b>{checked[leg.id] !== undefined ? `${checked[leg.id]} h` : "?"}</b></span>}
                    <i>{known !== undefined && checked[leg.id] !== undefined ? "✓" : ""}</i>
                  </li>
                );
              })}
              {decision && <li className="leg-hut"><span className="leg-name">{HUT_LEG.name}</span><b>{knowsHut ? `${HUT_LEG.hours} h` : "?"}</b></li>}
            </ul>
            <div className="map-total">
              <span>已走 {HOURS_ALREADY} h</span>
              <b>{allChecked ? `+ ${total.toFixed(1)} h = ${(HOURS_ALREADY + total).toFixed(1)} h` : `+ ${total.toFixed(1)} h …`}</b>
              <em className="sunset-scale">{SUNSET_LABEL} · 现在 {formatGameTime(minute)} · 天还剩 {sunsetLeft.toFixed(1)} h</em>
            </div>
            {decision && (
              <div className="map-choice">
                <button className="secondary-button" onClick={() => world.dispatch({ type: "ui:action", id: "map:choose:hut" })}>往山屋走</button>
                <button className="primary-button" onClick={() => world.dispatch({ type: "ui:action", id: "map:choose:retreat" })}>紧急下撤 · 656</button>
              </div>
            )}
            {journal.objective && <p className="map-margin-note">{journal.objective}</p>}
          </div>
        ) : (
          <div className="notes-face">
            <header><strong>本子</strong><span>铅笔</span></header>
            {journal.entries.length === 0 ? <p className="notes-empty">（还没写什么）</p> : journal.entries.map((id) => <p key={id}>{ENTRIES[id]?.line ?? id}</p>)}
          </div>
        )}
        <div className="paper-actions">
          <button className="secondary-button" onClick={() => setSide(side === "map" ? "notes" : "map")}>{side === "map" ? "翻到背面" : "翻回地图"}</button>
          <button className="primary-button" onClick={() => world.dispatch({ type: "overlay:close" })}>合上</button>
        </div>
      </div>
    </div>
  );
}
