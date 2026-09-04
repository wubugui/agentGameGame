/* 112: the three things she might try to say, each of them useless. */
import { useWorldContext, useWorldValue } from "../useWorld";

const TRIES = [
  { id: "where", label: "“I'm under the Sella. Val Lasties.”", reply: "…Sella? …pronto? …非常…杂音。" },
  { id: "alone", label: "“I'm alone. It's dark.”", reply: "…una persona? …信号断了一下。" },
  { id: "phone", label: "“My phone is at eight percent.”", reply: "……对方在说意大利语。听不清。" },
];

export function CallSheet() {
  const world = useWorldContext();
  const tried = useWorldValue((s) => (s.ui.overlayData.tried as string | undefined) ?? "");
  const connected = useWorldValue((s) => Boolean(s.ui.overlayData.connected));
  const battery = useWorldValue((s) => s.power.phone);
  const list = tried ? tried.split(",").filter(Boolean) : [];
  return (
    <div className="paper-overlay" role="dialog" aria-modal="true" aria-label="通话">
      <div className="call-sheet">
        <div className="call-number">112</div>
        <div className="call-status">{connected ? "通话中 · 信号很差" : "正在呼叫…"}</div>
        <div className="call-lines">
          {connected && <p>“Pronto, emergenza… soccorso alpino…”</p>}
          {list.map((id) => { const t = TRIES.find((x) => x.id === id); return t ? <><p className="mine" key={`${id}-m`}>{t.label}</p><p key={`${id}-r`}>{t.reply}</p></> : null; })}
        </div>
        {connected && TRIES.filter((t) => !list.includes(t.id)).map((t) => <button key={t.id} className="secondary-button call-next" onClick={() => world.dispatch({ type: "ui:action", id: "call:try", value: t.id })}>{t.label}</button>)}
        {connected && <button className="primary-button call-hangup" onClick={() => world.dispatch({ type: "ui:action", id: "call:hangup" })}>挂断 · 电量 {Math.round(battery)}%</button>}
      </div>
    </div>
  );
}
