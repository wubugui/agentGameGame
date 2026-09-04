import { RotateCcw } from "lucide-react";
import { useEffect } from "react";
import { CLOSING_LINES, LETTER_LINES_IT, LETTER_LINES_ZH } from "../data/letter";
import PanoStage from "../PanoStage";
import { useWorldContext, useWorldValue } from "./useWorld";
import { useRef } from "react";

const POEM = Math.max(LETTER_LINES_IT.length, LETTER_LINES_ZH.length);
const TOTAL = POEM + CLOSING_LINES.length + 1;

export function CreditsScreen() {
  const world = useWorldContext();
  const line = useWorldValue((s) => s.ui.creditLine);
  const motion = useWorldValue((s) => s.settings.motion);
  const anchor = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (line > TOTAL) return;
    const delay = line === 0 ? 1800 : line < POEM ? 1700 : line === POEM ? 5200 : 3800;
    const timer = window.setTimeout(() => world.patch("ui", { creditLine: world.state.ui.creditLine + 1 }), delay);
    return () => window.clearTimeout(timer);
  }, [line, world]);
  const done = line > TOTAL;
  const closingStart = POEM + 1;
  return (
    <main className="game-shell complete-screen" onPointerDown={() => { if (!done) world.dispatch({ type: "flow", action: "credits:skip" }); }}>
      <PanoStage asset="pano/22-bench.webp" light="day" look={{ x: 0, y: 0 }} walking={false} progress={0} breath="calm" anchorLayerRef={anchor} reduceMotion={!motion} />
      <div className="cinema-grade" />
      {!done ? (
        <div className="credits-poem" aria-live="polite">
          <div className={`credits-pair ${line >= closingStart ? "credits-dim" : ""}`}>
            <div className="credits-block credits-it">{LETTER_LINES_IT.map((text, index) => <p key={`it-${index}`} className={index < line ? "shown" : ""}>{text || " "}</p>)}</div>
            <div className="credits-block credits-zh">{LETTER_LINES_ZH.map((text, index) => <p key={`zh-${index}`} className={index < line ? "shown" : ""}>{text || " "}</p>)}</div>
          </div>
          {line >= closingStart && <div className="credits-block credits-closing">{CLOSING_LINES.map((text, index) => <p key={`c-${index}`} className={index + closingStart <= line ? "shown" : ""}>{text}</p>)}</div>}
          <p className="credits-skip">点击跳过</p>
        </div>
      ) : (
        <div className="complete-card">
          <p className="eyebrow">离开山谷以前</p>
          <h2>你是特别的。</h2>
          <p className="credits-source">根据一段真实的经历 · 2025 年 7 月 · Passo Sella</p>
          <p className="music-credit">Music: “Clear Air” “Simple Duet” “Promises to Keep” — Kevin MacLeod (incompetech.com) · CC BY 4.0</p>
          <button className="primary-button" onClick={() => world.dispatch({ type: "flow", action: "title" })}><RotateCcw size={16} /> 再走一次</button>
        </div>
      )}
    </main>
  );
}
