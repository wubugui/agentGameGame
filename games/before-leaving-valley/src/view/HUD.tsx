/* Almost no interface: a place card on arrival, three buttons while the hand moves, the chapter card, the weather. */
import { Settings as SettingsIcon, Smartphone, Volume2, VolumeX } from "lucide-react";
import { useEffect, useState } from "react";
import { lightOf } from "../engine/condition";
import { SCENES } from "../engine/scene";
import { formatGameTime } from "../phoneModel";
import { useWorldContext, useWorldValue } from "./useWorld";

const MOTE_SPOTS = Array.from({ length: 14 }, (_, index) => ({ x: (index * 37 + 11) % 100, y: 20 + (index * 53 + 7) % 70, dur: 11 + (index * 7) % 9, delay: -(index * 1.7) }));

export function HUD() {
  const world = useWorldContext();
  const sceneId = useWorldValue((s) => s.sceneId);
  const scene = SCENES[sceneId];
  const minute = useWorldValue((s) => s.clock.minuteOfDay);
  const date = useWorldValue((s) => `${s.clock.date.month}月${s.clock.date.day}日`);
  const chapter = useWorldValue((s) => s.ui.chapter);
  const light = useWorldValue((s) => Math.round(lightOf(s) * 20) / 20);
  const master = useWorldValue((s) => s.settings.master);
  const phoneLost = useWorldValue((s) => Boolean(s.flags["phone.lost"]));
  const unread = useWorldValue((s) => Object.values(s.phone.unread).reduce((sum, value) => sum + value, 0));
  const fear = useWorldValue((s) => s.body.fear);
  const breath = useWorldValue((s) => s.body.breath);
  const lampMode = useWorldValue((s) => s.power.lampMode);
  const lampOut = useWorldValue((s) => s.power.lampOut);
  const lamp = useWorldValue((s) => Math.round(s.power.lamp * 20) / 20);
  const hasPack = useWorldValue((s) => s.inventory.items.length > 0);
  const [awake, setAwake] = useState(true);
  const [fresh, setFresh] = useState(true);
  useEffect(() => {
    setFresh(true);
    const timer = window.setTimeout(() => setFresh(false), scene?.chapter ? 8800 : 4200);
    return () => window.clearTimeout(timer);
  }, [sceneId, scene?.chapter]);
  useEffect(() => {
    let timer = 0;
    const move = () => { setAwake(true); window.clearTimeout(timer); timer = window.setTimeout(() => setAwake(false), 2600); };
    window.addEventListener("pointermove", move, { passive: true });
    move();
    return () => { window.removeEventListener("pointermove", move); window.clearTimeout(timer); };
  }, []);

  const night = light <= 0 && world.state.clock.day === 1 && !scene?.interior;
  const forest = sceneId === "forest1" || sceneId === "forest2";
  const beatPeriod = Math.round(1000 - fear * 520);
  const look = world.rt.look;
  const beamStyle = { translate: `${((look.x + 1) * 50 - 150).toFixed(2)}vw ${((look.y + 1) * 50 - 150).toFixed(2)}vh` } as React.CSSProperties;
  const dusk = scene?.interior ? 0 : Math.max(0, 0.85 - light * 0.85) * (world.state.clock.day === 1 ? 1 : 0);
  const lampClass = lampMode ? `lamp-${lampMode} ${lampOut ? "lamp-out" : lamp < 0.45 ? "lamp-low" : ""}` : "";

  return (
    <>
      <div className="cinema-grade" />
      <div className="film-grain" />
      {scene && !scene.interior && dusk > 0 && <div className="dusk-fall" style={{ opacity: Math.min(0.85, dusk) }} />}
      {scene?.weather?.motes && <div className={`motes ${scene.weather.motes}`} aria-hidden="true">{MOTE_SPOTS.map((spot, index) => <i key={index} style={{ "--x": `${spot.x}%`, "--y": `${spot.y}%`, "--dur": `${spot.dur}s`, "--delay": `${spot.delay}s` } as React.CSSProperties} />)}</div>}
      {scene?.weather?.clouds && <div className="cloud-shadows" aria-hidden="true" />}
      <div className="breath-pulse" aria-hidden="true" />
      {night && <div className="breath-fog" aria-hidden="true" style={{ "--breath": `${breath === "recovery" ? 1.7 : 2.8}s` } as React.CSSProperties} />}
      {forest && lampMode && <div className={`lamp-light ${lampClass}`} aria-hidden="true"><i style={beamStyle} /></div>}
      {night && <div className={`night-darkness ${sceneId === "forestEdge" ? "faint" : sceneId === "hairpin" ? "road" : ""} ${lampClass}`}>{forest ? <i style={beamStyle} /> : null}</div>}
      {forest && <div className="fear-vignette" aria-hidden="true" style={{ "--beat": `${beatPeriod}ms`, "--beat-strength": (0.15 + fear * 0.55).toFixed(2) } as React.CSSProperties} />}
      {sceneId === "car" && <><div className="car-glass" aria-hidden="true"><div className="car-sweep"><i /><i /><i /></div><div className="tree-flicker" /><div className="wipers"><i /><i /></div></div><div className="dash-glow" aria-hidden="true" /></>}
      {chapter && <div className="chapter-card" key={chapter.title} aria-hidden="true"><small>{chapter.eyebrow}</small><strong>{chapter.title}</strong></div>}
      <div className={`scene-caption ${fresh || awake ? "shown" : ""}`}><span>{date} {formatGameTime(minute)}</span>{scene?.place} · {scene?.elevation}</div>
      <div className={`utility-controls ${awake ? "" : "asleep"}`}>
        <button onClick={() => world.dispatch({ type: "settings", patch: { master: master > 0 ? 0 : 0.9 } })} aria-label="切换声音">{master > 0 ? <Volume2 size={17} /> : <VolumeX size={17} />}</button>
        {hasPack && <button onClick={() => world.dispatch(world.state.ui.overlay === "pack" ? { type: "pack:close" } : { type: "pack:open" })} aria-label="背包"><span className="pack-glyph" /><kbd>I</kbd></button>}
        <button className={phoneLost ? "phone-missing" : ""} onClick={() => world.dispatch({ type: "phone:open" })} aria-label={phoneLost ? "手机不在身上" : "手机"}><Smartphone size={17} /><kbd>P</kbd>{!phoneLost && unread > 0 && <i className="unread-badge">{unread}</i>}</button>
        <button onClick={() => world.dispatch({ type: "menu", open: true })} aria-label="设置"><SettingsIcon size={17} /></button>
      </div>
    </>
  );
}
