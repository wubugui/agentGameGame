/* Something read up close: a plate, a sign, a board, a page. */
import { useWorldContext, useWorldValue } from "../useWorld";

export function Reading() {
  const world = useWorldContext();
  const reading = useWorldValue((s) => s.ui.reading);
  if (!reading) return null;
  return (
    <div className="paper-overlay reading-overlay" role="dialog" aria-modal="true" aria-label={reading.title} onPointerDown={(event) => { if (event.target === event.currentTarget) world.dispatch({ type: "overlay:close" }); }}>
      <div className={`reading-sheet kind-${reading.kind}`}>
        <header>{reading.title}</header>
        {reading.lines.map((line, index) => <p key={index}>{line || " "}</p>)}
        <button className="secondary-button" autoFocus onClick={() => world.dispatch({ type: "overlay:close" })}>放下</button>
      </div>
    </div>
  );
}
