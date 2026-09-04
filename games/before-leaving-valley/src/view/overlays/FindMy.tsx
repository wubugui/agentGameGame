/* Find My on the hotel laptop: a circle, not a point. */
import { formatGameTime } from "../../phoneModel";
import { useWorldContext, useWorldValue } from "../useWorld";

export function FindMy() {
  const world = useWorldContext();
  const lostAt = useWorldValue((s) => Number(s.flags["phone.lostAt"] ?? 22 * 60 + 18));
  const closing = useWorldValue((s) => Boolean(s.ui.overlayData.closing));
  return (
    <div className="paper-overlay" role="dialog" aria-modal="true" aria-label="Find My">
      <div className="findmy-sheet">
        <header><strong>Find My · 叉宝的 iPhone</strong><span>最后定位 · 昨晚 {formatGameTime(lostAt)} · Val Lasties</span></header>
        <div className="findmy-map"><div className="trail" /><div className="circle" /></div>
        <p>定位停在森林小路上段。一个圈，不是一个点。从那以后没有再更新。</p>
        <div className="paper-actions">
          {closing
            ? <button className="primary-button" onClick={() => world.dispatch({ type: "ui:action", id: "findmy:off" })}>关掉 Find My，合上电脑</button>
            : <button className="primary-button" autoFocus onClick={() => world.dispatch({ type: "overlay:close" })}>去那里看看</button>}
          {closing && <button className="secondary-button" onClick={() => world.dispatch({ type: "overlay:close" })}>先留着</button>}
        </div>
      </div>
    </div>
  );
}
