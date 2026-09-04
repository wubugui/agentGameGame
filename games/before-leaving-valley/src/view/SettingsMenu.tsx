import { useWorldContext, useWorldValue } from "./useWorld";

export function SettingsMenu() {
  const world = useWorldContext();
  const settings = useWorldValue((s) => s.settings);
  const phase = useWorldValue((s) => s.phase);
  const set = (patch: Partial<typeof settings>) => world.dispatch({ type: "settings", patch });
  return (
    <div className="menu-overlay" onPointerDown={(event) => { if (event.target === event.currentTarget) world.dispatch({ type: "menu", open: false }); }}>
      <div className="menu-card" role="dialog" aria-modal="true" aria-label="设置">
        <p className="eyebrow">离开山谷以前</p>
        <h3>设置</h3>
        <label className="menu-row"><span>环境声与音效</span><input type="range" min={0} max={1} step={0.05} value={settings.master} onChange={(event) => set({ master: Number(event.target.value) })} /><output>{Math.round(settings.master * 100)}</output></label>
        <label className="menu-row"><span>音乐</span><input type="range" min={0} max={1} step={0.05} value={settings.music} onChange={(event) => set({ music: Number(event.target.value) })} /><output>{Math.round(settings.music * 100)}</output></label>
        <label className="menu-row"><span>按住的时长</span><input type="range" min={0.5} max={2} step={0.1} value={settings.holdScale ?? 1} onChange={(event) => set({ holdScale: Number(event.target.value) })} /><output>{(settings.holdScale ?? 1).toFixed(1)}×</output></label>
        <div className="menu-toggle"><span>镜头呼吸与步伐晃动</span><button className={settings.motion ? "on" : ""} onClick={() => set({ motion: !settings.motion })}>{settings.motion ? "开" : "关"}</button></div>
        <div className="menu-actions">
          <button className="primary-button" autoFocus onClick={() => world.dispatch({ type: "menu", open: false })}>继续</button>
          {phase !== "title" && <button className="secondary-button" onClick={() => { world.dispatch({ type: "menu", open: false }); world.dispatch({ type: "flow", action: "title" }); }}>回到标题</button>}
        </div>
        <p className="menu-hint">ESC 打开或关闭</p>
      </div>
    </div>
  );
}
