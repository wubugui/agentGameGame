/* The one spoken line, and the short flash. */
import { useWorldValue } from "./useWorld";

export function DialogueLine() {
  const line = useWorldValue((s) => s.ui.line);
  const flash = useWorldValue((s) => s.ui.flash);
  return (
    <>
      {line && <div className="thought-line" key={line.key}>{line.text}</div>}
      {flash && <div className="world-feedback" key={flash.key}>{flash.text}</div>}
    </>
  );
}
