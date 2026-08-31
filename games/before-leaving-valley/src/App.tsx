import {
  ArrowLeft,
  BatteryMedium,
  Camera,
  Check,
  ChevronRight,
  Footprints,
  Image as ImageIcon,
  Map,
  MessageCircle,
  Mountain,
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

const SCENE_COPY: Record<JourneyScene, string[]> = {
  arrival: ["车门在身后合上时，我才意识到——整辆车只有我一个人下了。", "不过天气比预报里好。来都来了，就往上走一点点。"],
  trail: ["路比地图上的细线陡得多，但每一次回头，山谷都会再打开一点。", "前面有两条路，都像是能走。"],
  viewpoint: ["风忽然从山脊另一边吹过来，整片山谷就在那一刻亮了。", "原来不是所有风景，都需要先知道名字。"],
};

export default function App() {
  const [phase, setPhase] = useState<Phase>("title");
  const [scene, setScene] = useState<JourneyScene>("arrival");
  const [line, setLine] = useState(0);
  const [bagTaken, setBagTaken] = useState(false);
  const [walking, setWalking] = useState(false);
  const [walkProgress, setWalkProgress] = useState(0);
  const [route, setRoute] = useState<Route>(null);
  const [trailStep, setTrailStep] = useState(0);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [phoneTab, setPhoneTab] = useState<PhoneTab>("home");
  const [photoTaken, setPhotoTaken] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [toast, setToast] = useState("");
  const [canvasReady, setCanvasReady] = useState(false);
  const audioRef = useRef<AudioContext | null>(null);
  const footstepMark = useRef(0);
  const onCanvasReady = useCallback(() => setCanvasReady(true), []);

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 1700);
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
    filter.frequency.value = 680;
    gain.gain.value = 0.08;
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
    osc.frequency.setValueAtTime(84 + Math.random() * 25, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(42, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.035, ctx.currentTime);
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
    if (!walking || phase !== "arrival") return;
    const timer = window.setInterval(() => setWalkProgress((value) => Math.min(100, value + 2.25)), 80);
    return () => window.clearInterval(timer);
  }, [walking, phase]);

  useEffect(() => {
    if (walkProgress - footstepMark.current >= 12) {
      footstepMark.current = walkProgress;
      stepSound();
    }
    if (walkProgress < 100 || phase !== "arrival") return;
    setWalking(false);
    const timer = window.setTimeout(() => {
      setScene("trail");
      setPhase("trail");
      setLine(0);
    }, 850);
    return () => window.clearTimeout(timer);
  }, [walkProgress, phase, stepSound]);

  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "p" && phase !== "title" && phase !== "complete") setPhoneOpen((value) => !value);
      if (event.key.toLowerCase() === "w" && bagTaken && phase === "arrival" && !phoneOpen) setWalking(true);
      if (event.key === "Escape") setPhoneOpen(false);
    };
    const keyUp = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "w") setWalking(false);
    };
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    return () => {
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
    };
  }, [bagTaken, phase, phoneOpen]);

  const begin = () => {
    if (soundOn) startAudio();
    setPhase("arrival");
    setScene("arrival");
  };

  const chooseRoute = (choice: Exclude<Route, null>) => {
    setRoute(choice);
    setTrailStep(0);
    notify(choice === "stream" ? "溪水很浅，但石头有些滑" : "坡缓一些，只是会绕远一点");
  };

  const advanceTrail = () => {
    stepSound();
    if (trailStep < 3) {
      setTrailStep((value) => value + 1);
      return;
    }
    setWalking(true);
    window.setTimeout(() => {
      setWalking(false);
      setScene("viewpoint");
      setPhase("viewpoint");
      setLine(0);
    }, 1100);
  };

  const takePhoto = () => {
    setPhotoTaken(true);
    notify("已存入「这次真的有出门」");
    window.setTimeout(() => setPhoneTab("gallery"), 450);
  };

  const reset = () => {
    setPhase("title");
    setScene("arrival");
    setLine(0);
    setBagTaken(false);
    setWalking(false);
    setWalkProgress(0);
    footstepMark.current = 0;
    setRoute(null);
    setTrailStep(0);
    setPhoneOpen(false);
    setPhoneTab("home");
    setPhotoTaken(false);
  };

  if (phase === "title") return (
    <main className="game-shell title-screen">
      <PixiJourney scene="arrival" walking={false} onReady={onCanvasReady} />
      <div className="cinema-grade" />
      <div className={`title-card ${canvasReady ? "is-ready" : ""}`}>
        <p className="eyebrow">离开山谷以前 · 可玩切片 01</p>
        <h1>走到风景那里</h1>
        <p className="title-subtitle">只是临时下车，只是想往上走一点。<br />这时候，她还不知道今天会发生什么。</p>
        <button className="primary-button" onClick={begin}>拿上背包，下车 <ChevronRight size={18} /></button>
        <p className="title-hint">电脑浏览器 · 耳机推荐 · W / 鼠标长按行走 · P 打开手机</p>
      </div>
    </main>
  );

  if (phase === "complete") return (
    <main className="game-shell complete-screen">
      <PixiJourney scene="viewpoint" walking={false} />
      <div className="cinema-grade" />
      <div className="complete-card">
        <span className="completion-mark"><Check size={24} /></span>
        <p className="eyebrow">STAGE 01 · 抵达</p>
        <h2>今天最好的决定，<br />是多走了那一点点。</h2>
        <p>她只完成了一次普通的小冒险。<br />故事真正的意外，还在山路的另一边。</p>
        <div className="complete-actions">
          <button className="primary-button" onClick={reset}><RotateCcw size={17} /> 再走一次</button>
          <button className="ghost-button" onClick={() => { setPhase("viewpoint"); setPhoneOpen(true); setPhoneTab("gallery"); }}>查看照片</button>
        </div>
      </div>
    </main>
  );

  const info = INFO[scene];
  const copy = SCENE_COPY[scene];

  return (
    <main className={`game-shell scene-${scene}`}>
      <PixiJourney scene={scene} walking={walking} />
      <div className="cinema-grade" />
      <div className="film-grain" />

      <header className="hud">
        <div className="location-chip"><Mountain size={14} /><span>{info.place}</span><span className="hud-time">{info.time}</span></div>
        <div className="hud-actions">
          <button className="round-button" onClick={() => setSoundOn((value) => !value)} aria-label="切换声音">{soundOn ? <Volume2 size={18} /> : <VolumeX size={18} />}</button>
          <button className="phone-trigger" onClick={() => { setPhoneTab("home"); setPhoneOpen(true); }}><Smartphone size={17} /><span>P</span></button>
        </div>
      </header>

      {phase === "arrival" && (
        <div className="interaction arrival-interaction">
          {!bagTaken ? (
            <button className="world-hotspot bag-hotspot" onClick={() => { setBagTaken(true); notify("水、薄外套、充电宝……都带了"); }}>
              <span className="pulse-ring" /><span className="hotspot-copy">拿上背包</span>
            </button>
          ) : (
            <div className="walk-control">
              <div className="walk-copy"><Footprints size={17} /><span>{walkProgress < 100 ? "沿着旧路上山" : "前方传来溪水声……"}</span></div>
              <button
                className="hold-button"
                style={{ "--progress": `${walkProgress}%` } as React.CSSProperties}
                onPointerDown={() => setWalking(true)}
                onPointerUp={() => setWalking(false)}
                onPointerLeave={() => setWalking(false)}
              >
                <span>{walkProgress < 100 ? "长按行走" : "正在抵达"}</span><small>或按住 W</small>
              </button>
            </div>
          )}
        </div>
      )}

      {phase === "trail" && (
        <div className="interaction trail-interaction">
          {!route ? (
            <div className="route-choice">
              <p>溪边出现了一个不在地图上的岔口</p>
              <button onClick={() => chooseRoute("open")}><span>左侧</span><strong>沿开阔牧道</strong><small>路缓，绕得远</small></button>
              <button onClick={() => chooseRoute("stream")}><span>右侧</span><strong>踏石过溪</strong><small>更近，需要看准脚下</small></button>
            </div>
          ) : (
            <>
              <div className="route-status">{route === "stream" ? "踏石过溪" : "沿牧道上行"}<span>{Math.min(trailStep + 1, 4)} / 4</span></div>
              <button className={`foothold foothold-${Math.min(trailStep + 1, 4)}`} onClick={advanceTrail} aria-label={route === "stream" ? "踩向下一块石头" : "向前迈步"}>
                <span /><small>{trailStep < 3 ? (route === "stream" ? "下一块石头" : "继续向上") : "越过最后一段"}</small>
              </button>
            </>
          )}
        </div>
      )}

      {phase === "viewpoint" && (
        <div className="interaction viewpoint-interaction">
          {!photoTaken ? (
            <button className="camera-prompt" onClick={() => { setPhoneTab("camera"); setPhoneOpen(true); }}><Camera size={20} /><span>把这一刻拍下来</span></button>
          ) : (
            <button className="finish-prompt" onClick={() => setPhase("complete")}><span>在风里多坐一会儿</span><ChevronRight size={18} /></button>
          )}
        </div>
      )}

      {!phoneOpen && line < copy.length && (
        <button className="narration" onClick={() => setLine((value) => value + 1)}><span>{copy[line]}</span><ChevronRight size={16} /></button>
      )}

      {phoneOpen && <Phone tab={phoneTab} setTab={setPhoneTab} close={() => setPhoneOpen(false)} info={info} scene={scene} photoTaken={photoTaken} takePhoto={takePhoto} />}
      {toast && <div className="toast">{toast}</div>}
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
              <div className="chat-thread">
                <span className="chat-time">13:58</span>
                <p className="incoming">你真下车了？那站看起来什么都没有诶</p>
                <p className="outgoing">嗯！就走一小段～</p>
                <p className="outgoing">看到好看的给你拍 📷</p>
                <p className="incoming">行，晚上别错过末班车。还有，充电宝带了吗</p>
                <p className="outgoing">带了带了，像带小孩一样操心我</p>
                <span className="read-mark">已读</span>
              </div>
            </PhonePage>
          )}
          {tab === "map" && (
            <PhonePage title="离线地图" back={() => setTab("home")}>
              <div className="map-canvas">
                <svg viewBox="0 0 290 460" aria-label="山谷步道地图">
                  <path d="M18 405 C68 380 51 322 108 290 C166 258 126 184 200 145 C241 123 224 70 270 38" />
                  <path d="M20 90 C86 115 72 204 136 229 C211 259 197 340 275 385" />
                  <path className="route" d="M50 406 C87 368 76 330 108 290 C139 253 144 204 200 145" />
                  <circle className="origin" cx="50" cy="406" r="6" />
                  <circle className="you" cx={scene === "arrival" ? 60 : scene === "trail" ? 122 : 200} cy={scene === "arrival" ? 394 : scene === "trail" ? 270 : 145} r="8" />
                </svg>
                <span className="map-label origin-label">下车点</span>
                <span className="map-label you-label">你在这里</span>
                <div className="map-card"><strong>{info.place}</strong><span>末班车 19:10 · 已下载离线区域</span></div>
              </div>
            </PhonePage>
          )}
          {tab === "camera" && (
            <div className={`camera-app camera-${scene}`}>
              <div className="camera-top"><button onClick={() => setTab("home")}><ArrowLeft size={18} /></button><span>实况</span></div>
              <div className="focus-box" />
              <div className="camera-bottom"><span>照片</span><button className="shutter" onClick={takePhoto} aria-label="拍照" /></div>
            </div>
          )}
          {tab === "gallery" && (
            <PhonePage title="这次真的有出门" back={() => setTab("home")}>
              <div className="gallery-body">
                {photoTaken ? <><div className="saved-photo"><span>今天 · {info.time}</span></div><p>1 张照片</p></> : <div className="empty-gallery"><ImageIcon size={34} /><span>第一张照片，还在路上</span></div>}
              </div>
            </PhonePage>
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
