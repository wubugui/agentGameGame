import { Flashlight, Moon, Play, RotateCcw, Smartphone } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";

type LightMode = "flashlight" | "phone";

export default function NightLayerPreview() {
  const [light, setLight] = useState({ x: 50, y: 52 });
  const [lightMode, setLightMode] = useState<LightMode>("flashlight");
  const [carProgress, setCarProgress] = useState(-0.25);
  const [carMoving, setCarMoving] = useState(false);
  const carFrameRef = useRef(0);

  const moveLight = (event: ReactPointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setLight({
      x: Math.min(96, Math.max(4, ((event.clientX - rect.left) / rect.width) * 100)),
      y: Math.min(92, Math.max(8, ((event.clientY - rect.top) / rect.height) * 100)),
    });
  };

  const runCar = () => {
    cancelAnimationFrame(carFrameRef.current);
    const startedAt = performance.now();
    setCarProgress(-0.25);
    setCarMoving(true);
    const tick = (now: number) => {
      const t = Math.min(1, (now - startedAt) / 5200);
      const eased = 1 - Math.pow(1 - t, 3);
      setCarProgress(-0.25 + eased * 0.82);
      if (t < 1) carFrameRef.current = requestAnimationFrame(tick);
      else setCarMoving(false);
    };
    carFrameRef.current = requestAnimationFrame(tick);
  };

  useEffect(() => () => cancelAnimationFrame(carFrameRef.current), []);

  const lightingStyle = {
    "--light-x": `${light.x}%`,
    "--light-y": `${light.y}%`,
  } as CSSProperties;
  const carStyle = {
    "--car-x": `${carProgress * 100}%`,
  } as CSSProperties;

  return (
    <main className={`layer-preview light-${lightMode}`} onPointerMove={moveLight} style={lightingStyle}>
      <div className="night-background" style={{ backgroundImage: `url("${import.meta.env.BASE_URL}art/night-trail-base-v1.webp")` }} />
      <div className="night-ambient" />
      <div className="programmable-darkness" />
      <div className="light-volume" />

      <div className={`vehicle-layer ${carMoving ? "moving" : ""}`} style={carStyle}>
        <div className="headlight-beam beam-near" />
        <div className="headlight-beam beam-far" />
        <img src={`${import.meta.env.BASE_URL}art/rescue-car-cutout-v2.webp`} alt="独立分层的救援车辆" />
      </div>

      <header className="preview-toolbar">
        <span><Moon size={15} /> 分层场景测试</span>
        <div>
          <button className={lightMode === "flashlight" ? "active" : ""} onClick={() => setLightMode("flashlight")}><Flashlight size={15} /> 手电</button>
          <button className={lightMode === "phone" ? "active" : ""} onClick={() => setLightMode("phone")}><Smartphone size={15} /> 手机光</button>
          <button onClick={runCar}>{carProgress > 0.5 ? <RotateCcw size={15} /> : <Play size={15} />} 车辆进场</button>
          <a href="./">返回试玩</a>
        </div>
      </header>
      <div className="preview-note">环境底图 · 黑夜遮罩 · 动态光束 · 车辆精灵 · 车灯，五层独立运行</div>
    </main>
  );
}
