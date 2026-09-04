import { useState } from "react";
import { SCENES } from "../engine/scene";
import { formatGameTime } from "../phoneModel";
import { useWorldContext, useWorldValue } from "./useWorld";

export function TitleScreen({ hasSave }: { hasSave: boolean }) {
  const world = useWorldContext();
  const [look, setLook] = useState({ x: 0, y: 0 });
  const sceneId = useWorldValue((s) => s.sceneId);
  const minute = useWorldValue((s) => s.clock.minuteOfDay);
  return (
    <main className="game-shell title-screen" onPointerMove={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setLook({ x: ((event.clientX - rect.left) / rect.width - 0.5) * 2, y: ((event.clientY - rect.top) / rect.height - 0.5) * 2 }); }}>
      <div className="title-art" style={{ backgroundImage: `url("${import.meta.env.BASE_URL}pano/title-key-art.webp")`, "--tilt-x": `${(-look.x * 14).toFixed(1)}px`, "--tilt-y": `${(-look.y * 9).toFixed(1)}px` } as React.CSSProperties} />
      <div className="cinema-grade" />
      <div className="title-card is-ready">
        <p className="eyebrow">离开山谷以前</p>
        <h1>来都来了</h1>
        <p className="title-subtitle">多洛米蒂，Passo Sella。一个人，一条飞拉达，一整天。<br />山崖上的信箱里，有一封我读不懂的信。</p>
        <div className="title-actions">
          <button className="primary-button" onClick={() => world.dispatch({ type: "flow", action: hasSave ? "continue" : "begin" })}>{hasSave ? "继续" : "下车"}</button>
          {hasSave && <button className="secondary-button" onClick={() => world.dispatch({ type: "flow", action: "begin" })}>重新开始</button>}
          <button className="secondary-button" onClick={() => world.dispatch({ type: "menu", open: true })}>设置</button>
        </div>
        {hasSave && <p className="save-hint">上次停在 {SCENES[sceneId]?.place} · {formatGameTime(minute)}</p>}
        <p className="title-hint">移动鼠标环视，看向什么，什么才会亮起来 · I 背包 · P 手机 · 建议佩戴耳机</p>
        <p className="music-credit">根据 2025 年夏天一段真实的经历 · Music: Kevin MacLeod (incompetech.com) CC BY 4.0</p>
      </div>
    </main>
  );
}
