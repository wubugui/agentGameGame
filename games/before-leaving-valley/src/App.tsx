import {
  ArrowLeft,
  BatteryMedium,
  Camera,
  Check,
  Image as ImageIcon,
  Map,
  MessageCircle,
  RotateCcw,
  Smartphone,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import PixiJourney, { type JourneyScene } from "./PixiJourney";

type Phase = "title" | "arrival" | "trail" | "viewpoint" | "complete";
type PhoneTab = "home" | "chat" | "map" | "camera" | "gallery";
type Route = "open" | "stream" | null;

const INFO: Record<JourneyScene, { time: string; place: string; battery: number }> = {
  arrival: { time: "14:06", place: "洛恩谷 · 临时停靠点", battery: 82 },
  trail: { time: "14:39", place: "旧牧道 · 1.4 km", battery: 76 },
  viewpoint: { time: "15:21", place: "无名观景台 · 1,680 m", battery: 69 },
};

const STONES = [
  { x: 68, y: 70 },
  { x: 61, y: 61 },
  { x: 67, y: 51 },
  { x: 73, y: 41 },
];

export default function App() {
  const [phase, setPhase] = useState<Phase>("title");
  const [scene, setScene] = useState<JourneyScene>("arrival");
  const [canvasReady, setCanvasReady] = useState(false);
  const [bagTaken, setBagTaken] = useState(false);
  const [bagPos, setBagPos] = useState({ x: 84, y: 74 });
  const [bagDragging, setBagDragging] = useState(false);
  const [arrivalProgress, setArrivalProgress] = useState(0);
  const [trailProgress, setTrailProgress] = useState(0);
  const [route, setRoute] = useState<Route>(null);
  const [streamStep, setStreamStep] = useState(0);
  const [moving, setMoving] = useState(false);
  const [look, setLook] = useState({ x: 50, y: 50 });
  const [thought, setThought] = useState("");
  const [feedback, setFeedback] = useState("");
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [phoneTab, setPhoneTab] = useState<PhoneTab>("home");
  const [photoTaken, setPhotoTaken] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const audioRef = useRef<AudioContext | null>(null);
  const pressedRef = useRef(new Set<string>());
  const worldHeldRef = useRef(false);
  const lastFrameRef = useRef(0);
  const bagStartRef = useRef({ x: 0, y: 0 });
  const transitionRef = useRef(false);
  const onCanvasReady = useCallback(() => setCanvasReady(true), []);

  const flash = useCallback((message: string) => {
    setFeedback(message);
    window.setTimeout(() => setFeedback(""), 1500);
  }, []);

  const startAudio = useCallback(() => {
    if (audioRef.current) return;
    const AudioCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;
    const ctx = new AudioCtor();
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i += 1) {
      last = last * 0.985 + (Math.random() * 2 - 1) * 0.015;
      data[i] = last;
    }
    const wind = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    wind.buffer = buffer;
    wind.loop = true;
    filter.type = "lowpass";
    filter.frequency.value = 720;
    gain.gain.value = 0.075;
    wind.connect(filter).connect(gain).connect(ctx.destination);
    wind.start();
    audioRef.current = ctx;
  }, []);

  const stepSound = useCallback(() => {
    const ctx = audioRef.current;
    if (!ctx || !soundOn) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(76 + Math.random() * 28, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.13);
    gain.gain.setValueAtTime(0.032, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.14);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
  }, [soundOn]);

  useEffect(() => {
    const ctx = audioRef.current;
    if (!ctx) return;
    if (soundOn && ctx.state === "suspended") void ctx.resume();
    if (!soundOn && ctx.state === "running") void ctx.suspend();
  }, [soundOn]);

  useEffect(() => {
    const timers: number[] = [];
    setThought("");
    if (phase === "arrival") {
      timers.push(window.setTimeout(() => setThought("车门合上时，我才发现——整辆车只有我一个人下了。"), 650));
      timers.push(window.setTimeout(() => setThought("不过天气比预报里好。来都来了，就往上走一点点。"), 4300));
    }
    if (phase === "trail") {
      timers.push(window.setTimeout(() => setThought("地图上只有一条细线，眼前却有两条路。"), 600));
      timers.push(window.setTimeout(() => setThought("不用猜哪条正确。选一条，自己走过去。"), 3900));
    }
    if (phase === "viewpoint") {
      timers.push(window.setTimeout(() => setThought("风从山脊另一边吹过来，整片山谷忽然亮了。"), 700));
      timers.push(window.setTimeout(() => setThought("原来不是所有风景，都需要先知道名字。"), 4300));
    }
    return () => timers.forEach(window.clearTimeout);
  }, [phase]);

  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      pressedRef.current.add(key);
      if (key === "p" && phase !== "title" && phase !== "complete") {
        setPhoneOpen((value) => !value);
        setPhoneTab("home");
      }
      if (event.key === "Escape") setPhoneOpen(false);
      if (event.code === "Space" && phase === "trail" && route === "stream") {
        event.preventDefault();
        advanceStone();
      }
      if (key === "w" && ((phase === "arrival" && bagTaken) || (phase === "trail" && route === "open"))) setMoving(true);
    };
    const keyUp = (event: KeyboardEvent) => {
      pressedRef.current.delete(event.key.toLowerCase());
      if (event.key.toLowerCase() === "w") setMoving(worldHeldRef.current);
    };
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    return () => {
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
    };
  });

  useEffect(() => {
    let frame = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.04, (now - (lastFrameRef.current || now)) / 1000);
      lastFrameRef.current = now;
      const active = !phoneOpen && (worldHeldRef.current || pressedRef.current.has("w"));
      if (active && phase === "arrival" && bagTaken) setArrivalProgress((value) => Math.min(1, value + dt * 0.19));
      if (active && phase === "trail" && route === "open") setTrailProgress((value) => Math.min(1, value + dt * 0.17));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [phase, bagTaken, route, phoneOpen]);

  useEffect(() => {
    if (arrivalProgress < 1 || transitionRef.current) return;
    transitionRef.current = true;
    setMoving(false);
    const timer = window.setTimeout(() => {
      setScene("trail");
      setPhase("trail");
      transitionRef.current = false;
    }, 700);
    return () => window.clearTimeout(timer);
  }, [arrivalProgress]);

  useEffect(() => {
    if (trailProgress < 1 || transitionRef.current) return;
    transitionRef.current = true;
    setMoving(false);
    const timer = window.setTimeout(() => {
      setScene("viewpoint");
      setPhase("viewpoint");
      transitionRef.current = false;
    }, 750);
    return () => window.clearTimeout(timer);
  }, [trailProgress]);

  useEffect(() => {
    if (!photoTaken || phoneOpen || phase !== "viewpoint") return;
    const timer = window.setTimeout(() => setPhase("complete"), 3600);
    return () => window.clearTimeout(timer);
  }, [photoTaken, phoneOpen, phase]);

  const begin = () => {
    if (soundOn) startAudio();
    setScene("arrival");
    setPhase("arrival");
  };

  const coords = (event: React.PointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
  };

  const worldDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (phoneOpen) return;
    const p = coords(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    if (phase === "arrival") {
      if (!bagTaken) {
        flash("背包还在候车亭里");
        return;
      }
      if (p.x > 0.37 && p.x < 0.74 && p.y > 0.34) {
        worldHeldRef.current = true;
        setMoving(true);
      } else flash(p.x < 0.38 ? "公路往山下绕去了" : "那边没有路");
    }
    if (phase === "trail") {
      if (route === null && p.x < 0.53 && p.y > 0.34) {
        setRoute("open");
        worldHeldRef.current = true;
        setMoving(true);
        setThought("我选了左边。路远一点，但能一直看见山。 ");
      } else if (route === "open" && p.x < 0.58 && p.y > 0.3) {
        worldHeldRef.current = true;
        setMoving(true);
      } else if (route === null) flash("溪水里的石头可以踩");
    }
  };

  const worldMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const p = coords(event);
    setLook({ x: p.x * 100, y: p.y * 100 });
  };

  const worldUp = () => {
    worldHeldRef.current = false;
    if (!pressedRef.current.has("w")) setMoving(false);
  };

  const bagDown = (event: React.PointerEvent<HTMLImageElement>) => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    bagStartRef.current = { x: event.clientX, y: event.clientY };
    setBagDragging(true);
  };

  const bagMove = (event: React.PointerEvent<HTMLImageElement>) => {
    if (!bagDragging) return;
    setBagPos({ x: event.clientX / window.innerWidth * 100, y: event.clientY / window.innerHeight * 100 });
  };

  const bagUp = (event: React.PointerEvent<HTMLImageElement>) => {
    const pulledDown = event.clientY - bagStartRef.current.y > 85 || event.clientY / window.innerHeight > 0.82;
    setBagDragging(false);
    if (pulledDown) {
      setBagTaken(true);
      setThought("水、薄外套、充电宝。都在。走吧。");
      stepSound();
    } else setBagPos({ x: 84, y: 74 });
  };

  function advanceStone() {
    if (transitionRef.current) return;
    if (route === null) {
      setRoute("stream");
      setThought("石头只露出一点。看准下一块，再落脚。");
    }
    stepSound();
    setMoving(true);
    window.setTimeout(() => setMoving(false), 230);
    setStreamStep((value) => {
      const next = value + 1;
      setTrailProgress(Math.min(1, next / STONES.length));
      return next;
    });
  }

  const takePhoto = () => {
    flash("咔嚓");
    if (scene === "viewpoint") {
      setPhotoTaken(true);
      window.setTimeout(() => setPhoneTab("gallery"), 420);
    }
  };

  const reset = () => {
    setPhase("title");
    setScene("arrival");
    setBagTaken(false);
    setBagPos({ x: 84, y: 74 });
    setArrivalProgress(0);
    setTrailProgress(0);
    setRoute(null);
    setStreamStep(0);
    setMoving(false);
    setPhoneOpen(false);
    setPhoneTab("home");
    setPhotoTaken(false);
    setThought("");
    transitionRef.current = false;
  };

  if (phase === "title") return (
    <main className="game-shell title-screen">
      <PixiJourney scene="arrival" walking={false} onReady={onCanvasReady} />
      <div className="cinema-grade" />
      <div className={`title-card ${canvasReady ? "is-ready" : ""}`}>
        <p className="eyebrow">离开山谷以前 · 第一段</p>
        <h1>走到风景那里</h1>
        <p className="title-subtitle">只是临时下车，只是想往上走一点。<br />这时候，她还不知道今天会发生什么。</p>
        <button className="primary-button" onClick={begin}>下车</button>
        <p className="title-hint">鼠标观察与操作 · 按住 W 前进 · P 打开手机 · 建议佩戴耳机</p>
      </div>
    </main>
  );

  if (phase === "complete") return (
    <main className="game-shell complete-screen">
      <PixiJourney scene="viewpoint" walking={false} progress={1} />
      <div className="cinema-grade" />
      <div className="complete-card">
        <span className="completion-mark"><Check size={23} /></span>
        <p className="eyebrow">STAGE 01 · 抵达</p>
        <h2>今天最好的决定，<br />是多走了那一点点。</h2>
        <p>风还在山谷里。手机里，多了一张刚刚拍下的照片。</p>
        <button className="primary-button" onClick={reset}><RotateCcw size={16} /> 再走一次</button>
      </div>
    </main>
  );

  const info = INFO[scene];
  const progress = phase === "arrival" ? arrivalProgress : phase === "trail" ? trailProgress : 0;
  const stone = STONES[Math.min(streamStep, STONES.length - 1)];

  return (
    <main className={`game-shell scene-${scene} ${moving ? "is-moving" : ""}`}>
      <PixiJourney scene={scene} walking={moving} progress={progress} />
      <div className="cinema-grade" />
      <div className="film-grain" />

      <div className="scene-caption"><span>{info.time}</span>{info.place}</div>
      <div className="utility-controls">
        <button onClick={() => setSoundOn((value) => !value)} aria-label="切换声音">{soundOn ? <Volume2 size={17} /> : <VolumeX size={17} />}</button>
        <button onClick={() => { setPhoneTab("home"); setPhoneOpen(true); }} aria-label="打开手机"><Smartphone size={17} /><kbd>P</kbd></button>
      </div>

      <div className="world-input" onPointerDown={worldDown} onPointerMove={worldMove} onPointerUp={worldUp} onPointerCancel={worldUp}>
        <span className="gaze-dot" style={{ left: `${look.x}%`, top: `${look.y}%` }} />
      </div>

      {phase === "arrival" && !bagTaken && (
        <img
          className={`backpack-object ${bagDragging ? "dragging" : ""}`}
          src={`${import.meta.env.BASE_URL}art/stage1-backpack.webp`}
          alt="候车亭座椅上的背包"
          draggable={false}
          style={{ left: `${bagPos.x}%`, top: `${bagPos.y}%` }}
          onPointerDown={bagDown}
          onPointerMove={bagMove}
          onPointerUp={bagUp}
          onPointerCancel={bagUp}
        />
      )}

      {phase === "trail" && route !== "open" && streamStep < STONES.length && (
        <div className="stone-target" style={{ left: `${stone.x}%`, top: `${stone.y}%` }} onPointerDown={(event) => { event.stopPropagation(); advanceStone(); }} role="button" aria-label="踩向下一块石头"><span /></div>
      )}

      {thought && <div className="thought-line">{thought}</div>}
      {feedback && <div className="world-feedback">{feedback}</div>}

      <div className="action-whisper">
        {phase === "arrival" && !bagTaken && "抓住背包，拖向画面下方"}
        {phase === "arrival" && bagTaken && arrivalProgress === 0 && "按住 W，或直接按住山路前进"}
        {phase === "arrival" && bagTaken && arrivalProgress > 0 && arrivalProgress < 1 && "松开会停下 · 鼠标仍可观察周围"}
        {phase === "trail" && route === null && "左侧山路可以直接走 · 右侧石头可以逐块踩"}
        {phase === "trail" && route === "open" && "继续按住 W，或按住左侧山路"}
        {phase === "trail" && route === "stream" && streamStep < STONES.length && "看准发亮的石面，直接踩上去 · 空格亦可"}
        {phase === "viewpoint" && !photoTaken && "按 P 拿出手机，亲自拍下它"}
        {phase === "viewpoint" && photoTaken && "收起手机。听一会儿风。"}
      </div>

      {phoneOpen && <Phone tab={phoneTab} setTab={setPhoneTab} close={() => setPhoneOpen(false)} info={info} scene={scene} photoTaken={photoTaken} takePhoto={takePhoto} />}
    </main>
  );
}

function Phone({ tab, setTab, close, info, scene, photoTaken, takePhoto }: {
  tab: PhoneTab;
  setTab: (tab: PhoneTab) => void;
  close: () => void;
  info: { time: string; place: string; battery: number };
  scene: JourneyScene;
  photoTaken: boolean;
  takePhoto: () => void;
}) {
  return (
    <div className="phone-overlay" role="dialog" aria-label="手机" aria-modal="true">
      <button className="phone-backdrop" onClick={close} aria-label="关闭手机" />
      <div className="phone-charm" aria-hidden="true"><span>✿</span></div>
      <div className="phone-frame">
        <div className="phone-speaker" />
        <div className="phone-status"><span>{info.time}</span><span>{info.battery}% <BatteryMedium size={15} /></span></div>
        <button className="phone-close" onClick={close} aria-label="关闭手机"><X size={17} /></button>
        <div className="phone-content">
          {tab === "home" && (
            <div className="phone-home">
              <div className="lock-caption">10月17日 · 周四</div>
              <div className="lock-time">{info.time}</div>
              <div className="lock-note">今日计划：随便走走，别错过末班车</div>
              <div className="app-grid">
                <PhoneApp icon={<MessageCircle />} label="消息" tone="coral" onClick={() => setTab("chat")} />
                <PhoneApp icon={<Map />} label="地图" tone="green" onClick={() => setTab("map")} />
                <PhoneApp icon={<Camera />} label="相机" tone="gray" onClick={() => setTab("camera")} />
                <PhoneApp icon={<ImageIcon />} label="相册" tone="sand" onClick={() => setTab("gallery")} />
              </div>
            </div>
          )}
          {tab === "chat" && (
            <PhonePage title="小鱼" back={() => setTab("home")}>
              <div className="chat-thread"><span className="chat-time">13:58</span><p className="incoming">你真下车了？那站看起来什么都没有诶</p><p className="outgoing">嗯！就走一小段～</p><p className="outgoing">看到好看的给你拍 📷</p><p className="incoming">晚上别错过末班车。还有，充电宝带了吗</p><p className="outgoing">带了带了，像带小孩一样操心我</p><span className="read-mark">已读</span></div>
            </PhonePage>
          )}
          {tab === "map" && (
            <PhonePage title="离线地图" back={() => setTab("home")}>
              <div className="map-canvas"><svg viewBox="0 0 290 460" aria-label="山谷步道地图"><path d="M18 405 C68 380 51 322 108 290 C166 258 126 184 200 145 C241 123 224 70 270 38" /><path d="M20 90 C86 115 72 204 136 229 C211 259 197 340 275 385" /><path className="route" d="M50 406 C87 368 76 330 108 290 C139 253 144 204 200 145" /><circle className="origin" cx="50" cy="406" r="6" /><circle className="you" cx={scene === "arrival" ? 60 : scene === "trail" ? 122 : 200} cy={scene === "arrival" ? 394 : scene === "trail" ? 270 : 145} r="8" /></svg><span className="map-label origin-label">下车点</span><span className="map-label you-label">你在这里</span><div className="map-card"><strong>{info.place}</strong><span>末班车 19:10 · 已下载离线区域</span></div></div>
            </PhonePage>
          )}
          {tab === "camera" && (
            <div className={`camera-app camera-${scene}`}><div className="camera-top"><button onClick={() => setTab("home")}><ArrowLeft size={18} /></button><span>实况</span></div><div className="focus-box" /><div className="camera-bottom"><span>照片</span><button className="shutter" onClick={takePhoto} aria-label="拍照" /></div></div>
          )}
          {tab === "gallery" && (
            <PhonePage title="这次真的有出门" back={() => setTab("home")}><div className="gallery-body">{photoTaken ? <><div className="saved-photo"><span>今天 · {info.time}</span></div><p>1 张照片</p></> : <div className="empty-gallery"><ImageIcon size={34} /><span>第一张照片，还在路上</span></div>}</div></PhonePage>
          )}
        </div>
        <div className="phone-homebar" />
      </div>
    </div>
  );
}

function PhoneApp({ icon, label, tone, onClick }: { icon: React.ReactNode; label: string; tone: string; onClick: () => void }) {
  return <button onClick={onClick}><span className={`app-icon ${tone}`}>{icon}</span><small>{label}</small></button>;
}

function PhonePage({ title, back, children }: { title: string; back: () => void; children: React.ReactNode }) {
  return <div className="phone-page"><div className="app-title"><button onClick={back}><ArrowLeft size={18} /></button><strong>{title}</strong></div>{children}</div>;
}
