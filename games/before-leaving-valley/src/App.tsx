"use client";

import {
  ArrowRight,
  BatteryMedium,
  Camera,
  ChevronDown,
  Compass,
  GalleryHorizontalEnd,
  Languages,
  Map,
  MapPin,
  Moon,
  MousePointer2,
  Phone,
  RotateCcw,
  Search,
  Smartphone,
  Sparkles,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

type Scene =
  | "title"
  | "ridge"
  | "mailbox"
  | "dusk"
  | "forest"
  | "road"
  | "search"
  | "busstop"
  | "recovered"
  | "ending";
type PhoneTab = "home" | "map" | "camera" | "gallery" | "translate";

const META: Record<Exclude<Scene, "title">, { time: string; place: string; battery: number; tone: string }> = {
  ridge: { time: "16:42", place: "无名山脊", battery: 64, tone: "warm" },
  mailbox: { time: "16:51", place: "崖边信箱", battery: 61, tone: "warm" },
  dusk: { time: "18:07", place: "山顶岔路", battery: 38, tone: "dusk" },
  forest: { time: "19:36", place: "北坡林道", battery: 19, tone: "night" },
  road: { time: "21:12", place: "山脚公路", battery: 0, tone: "blue" },
  search: { time: "22:48", place: "小镇警署", battery: 0, tone: "night" },
  busstop: { time: "23:26", place: "末班车站", battery: 0, tone: "blue" },
  recovered: { time: "23:31", place: "末班车站", battery: 7, tone: "blue" },
  ending: { time: "00:18", place: "离开山谷", battery: 5, tone: "night" },
};

const LINES: Partial<Record<Scene, string[]>> = {
  ridge: ["下午四点，我还觉得自己只是比计划慢了一点。", "缆绳尽头的铁盒子太像一个邮箱了。它不该在这里。"],
  dusk: ["我终于承认：地图上的蓝点，已经离回程的路很远了。", "太阳落得比电量更快。"],
  forest: ["手机的光只能照亮下一步。山林把其余的路都收走了。", "我开始只数脚步，不再数时间。"],
  road: ["冲出林子的时候，我摔了一跤。", "等我摸到公路，口袋里只剩那封信。"],
  search: ["好心人把我送到镇上。我们沿路找了两遍，又打了无数次电话。", "没有铃声。没有定位。像是山把它留下了。"],
  busstop: ["我决定坐末班车离开。以后再也不一个人爬陌生的山。", "车来以前，一个陌生女人站到了灯下。"],
  recovered: ["她说，手机躺在公路中央。屏幕朝上，一直亮着。", "可那段公路，我们明明来回找过。"],
};

function RoundButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return <button className="round-button" aria-label={label} title={label} onClick={onClick} disabled={disabled}>{children}</button>;
}

export default function Home() {
  const [scene, setScene] = useState<Scene>("title");
  const [line, setLine] = useState(0);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [phoneTab, setPhoneTab] = useState<PhoneTab>("home");
  const [photos, setPhotos] = useState<string[]>([]);
  const [letterSeen, setLetterSeen] = useState(false);
  const [mapSeen, setMapSeen] = useState(false);
  const [forestSteps, setForestSteps] = useState(0);
  const [waveCount, setWaveCount] = useState(0);
  const [searchStep, setSearchStep] = useState(0);
  const [translated, setTranslated] = useState(false);
  const [flashlight, setFlashlight] = useState({ x: 50, y: 56 });
  const [soundOn, setSoundOn] = useState(true);
  const [toast, setToast] = useState("");
  const audioRef = useRef<AudioContext | null>(null);

  const phoneLost = ["road", "search", "busstop"].includes(scene);
  const meta = scene === "title" ? null : META[scene];
  const lines = LINES[scene] ?? [];

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 1700);
  }, []);

  const startAmbient = useCallback(() => {
    if (audioRef.current) return;
    const AudioCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;
    const ctx = new AudioCtor();
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let previous = 0;
    for (let i = 0; i < data.length; i += 1) {
      previous = previous * 0.97 + (Math.random() * 2 - 1) * 0.03;
      data[i] = previous;
    }
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    source.buffer = buffer; source.loop = true;
    filter.type = "lowpass"; filter.frequency.value = 820; gain.gain.value = 0.055;
    source.connect(filter).connect(gain).connect(ctx.destination); source.start();
    audioRef.current = ctx;
  }, []);

  const go = useCallback((next: Scene) => {
    setScene(next); setLine(0); setPhoneOpen(false);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "p" && scene !== "title" && !phoneLost) setPhoneOpen(value => !value);
      if (event.key === "Escape") setPhoneOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [scene, phoneLost]);

  useEffect(() => {
    const ctx = audioRef.current;
    if (!ctx) return;
    if (soundOn && ctx.state === "suspended") void ctx.resume();
    if (!soundOn && ctx.state === "running") void ctx.suspend();
  }, [soundOn]);

  const openPhone = (tab: PhoneTab = "home") => {
    if (phoneLost) return notify("口袋是空的");
    setPhoneTab(tab); setPhoneOpen(true);
  };

  const takePhoto = (id: string) => {
    if (!photos.includes(id)) setPhotos(items => [...items, id]);
    notify("照片已保存");
  };

  const reset = () => {
    setScene("title"); setLine(0); setPhoneOpen(false); setPhoneTab("home"); setPhotos([]);
    setLetterSeen(false); setMapSeen(false); setForestSteps(0); setWaveCount(0); setSearchStep(0); setTranslated(false);
  };

  if (scene === "title") return (
    <main className="game-shell title-screen">
      <div className="title-art" aria-hidden="true" /><div className="grain" aria-hidden="true" />
      <div className="title-card">
        <p className="eyebrow">一段关于迷路与归还的短篇</p>
        <h1>离开山谷以前</h1>
        <p className="title-subtitle">有些东西不是被找回来的。<br />它们只是在合适的时候，重新出现。</p>
        <button className="primary-button" onClick={() => { if (soundOn) startAmbient(); go("ridge"); }}>进入山谷 <ArrowRight size={18} /></button>
        <p className="title-hint">推荐佩戴耳机 · 点击探索 · P 键打开手机</p>
      </div>
      <button className="sound-toggle" onClick={() => setSoundOn(value => !value)} aria-label={soundOn ? "关闭声音" : "开启声音"}>{soundOn ? <Volume2 size={18} /> : <VolumeX size={18} />}</button>
    </main>
  );

  return (
    <main className="game-shell">
      <section
        className={`scene scene-${scene} tone-${meta?.tone}`}
        onPointerMove={(event) => {
          if (scene !== "forest") return;
          const rect = event.currentTarget.getBoundingClientRect();
          setFlashlight({ x: (event.clientX - rect.left) / rect.width * 100, y: (event.clientY - rect.top) / rect.height * 100 });
        }}
      >
        <div className="scene-art" aria-hidden="true" /><div className="scene-grade" aria-hidden="true" />
        {scene === "forest" && <div className="flashlight" style={{ "--light-x": `${flashlight.x}%`, "--light-y": `${flashlight.y}%` } as React.CSSProperties} aria-hidden="true" />}
        <div className="grain" aria-hidden="true" />

        <header className="hud">
          <div className="location-chip"><MapPin size={14} /><span>{meta?.place}</span><span className="hud-time">{meta?.time}</span></div>
          <div className="hud-actions">
            <RoundButton label={soundOn ? "关闭环境音" : "开启环境音"} onClick={() => setSoundOn(value => !value)}>{soundOn ? <Volume2 size={18} /> : <VolumeX size={18} />}</RoundButton>
            <RoundButton label={phoneLost ? "手机不在身上" : "打开手机"} onClick={() => openPhone()} disabled={phoneLost}><Smartphone size={18} /></RoundButton>
          </div>
        </header>

        {scene === "ridge" && <><button className="hotspot hotspot-mailbox" onClick={() => go("mailbox")} aria-label="查看崖边的铁盒子"><span className="hotspot-ring" /><span className="hotspot-label">像是一个信箱</span></button><div className="micro-hint"><MousePointer2 size={14} /> 寻找画面里的异样</div></>}

        {scene === "mailbox" && <div className="letter-inspection">
          <div className="letter-paper"><span className="letter-stamp">1998</span><p className="letter-foreign">Non tutto ciò che si perde desidera essere trovato.</p><p className="letter-foreign smaller">La valle restituisce soltanto ciò che puoi portare via.</p><div className="letter-signature">— M.</div></div>
          <div className="inspection-actions">
            <button className="action-button" onClick={() => { takePhoto("letter"); setLetterSeen(true); }}><Camera size={18} /> 拍下它</button>
            <button className="ghost-button" disabled={!letterSeen} onClick={() => go("dusk")}>收好照片，继续上山 <ArrowRight size={17} /></button>
          </div>
        </div>}

        {scene === "dusk" && <div className="dusk-choice">
          <button className="map-prompt" onClick={() => openPhone("map")}><Compass size={22} /><span>确认回程方向</span></button>
          {mapSeen && <button className="continue-pill" onClick={() => go("forest")}>趁还有光，下山 <ChevronDown size={18} /></button>}
        </div>}

        {scene === "forest" && <div className="forest-interaction">
          <p className="flashlight-instruction">移动光束，在黑暗里寻找下一步 · {forestSteps}/3</p>
          {[0, 1, 2].map(step => <button key={step} className={`forest-step forest-step-${step + 1} ${forestSteps === step ? "active" : ""}`} disabled={forestSteps !== step} onClick={() => { const next = forestSteps + 1; setForestSteps(next); if (next === 3) window.setTimeout(() => go("road"), 900); }} aria-label={`踩稳第 ${step + 1} 步`}><span /></button>)}
        </div>}

        {scene === "road" && <div className="road-interaction">
          <div className={`headlights wave-${waveCount}`} aria-hidden="true" />
          <button className="wave-button" onClick={() => { const next = waveCount + 1; setWaveCount(next); if (next === 1) notify("车灯掠过去，没有减速"); if (next >= 2) window.setTimeout(() => go("search"), 1000); }}>{waveCount === 0 ? "向远处挥手" : waveCount === 1 ? "再试一次" : "车停下了"}</button>
        </div>}

        {scene === "search" && <div className="search-panel">
          <div className="search-progress">{[0, 1, 2].map(item => <span key={item} className={searchStep >= item ? "done" : ""} />)}</div>
          <h2>{searchStep === 0 ? "沿公路找一遍" : searchStep === 1 ? "借电话再打一次" : "接受今晚找不到了"}</h2>
          <p>{searchStep === 0 ? "司机把车开得很慢。路面空空的。" : searchStep === 1 ? "铃声只在听筒里响。山那边没有回应。" : "警员留下了你的住址，说有消息会寄过去。"}</p>
          <button className="action-button" onClick={() => { if (searchStep < 2) setSearchStep(value => value + 1); else go("busstop"); }}>{searchStep === 0 ? <Search size={18} /> : searchStep === 1 ? <Phone size={18} /> : <Moon size={18} />}{searchStep < 2 ? "继续" : "去等末班车"}</button>
        </div>}

        {scene === "busstop" && <div className="stranger-scene"><div className="stranger-silhouette" aria-hidden="true" /><div className="speech-card"><span className="speaker">陌生女人</span><p>“这是你的吗？”</p><button className="ghost-button" onClick={() => go("recovered")}>她掌心里，是我的手机 <ArrowRight size={17} /></button></div></div>}

        {scene === "recovered" && <div className="recovered-action">{!translated ? <button className="phone-found" onClick={() => openPhone("gallery")}><Smartphone size={28} /><span>屏幕没有裂，电量只剩 7%</span><small>打开相册</small></button> : <button className="continue-pill" onClick={() => go("ending")}>末班车到了 <ArrowRight size={18} /></button>}</div>}

        {scene === "ending" && <div className="ending-card">
          <p className="eyebrow">00:18 · 离开山谷</p><h2>后来我不再试着证明<br />那一晚究竟发生了什么。</h2>
          <p>只是每次有人说自己迷路了，我都会想起那封信：<br />山谷归还的，从来不是原来的东西。</p>
          <div className="ending-letter">“不是所有失去的东西，都希望被找到。<br />山谷只归还你已经能够带走的。”</div>
          <button className="ghost-button" onClick={reset}><RotateCcw size={17} /> 再走一次</button>
        </div>}

        {lines.length > 0 && !phoneOpen && <button className="narration" onClick={() => line < lines.length - 1 && setLine(value => value + 1)}><span>{lines[line]}</span>{line < lines.length - 1 && <ChevronDown size={17} />}</button>}
      </section>

      {phoneOpen && meta && <div className="phone-overlay" role="dialog" aria-modal="true" aria-label="手机">
        <button className="phone-backdrop" onClick={() => setPhoneOpen(false)} aria-label="关闭手机" />
        <div className="phone-frame"><div className="phone-speaker" /><div className="phone-status"><span>{meta.time}</span><span>{meta.battery}% <BatteryMedium size={15} /></span></div><button className="phone-close" onClick={() => setPhoneOpen(false)} aria-label="关闭手机"><X size={18} /></button>
          <div className="phone-content">
            {phoneTab === "home" && <div className="phone-home"><div className="phone-date">10月17日<br /><strong>{meta.time}</strong></div><div className="app-grid">
              <button onClick={() => setPhoneTab("map")}><span className="app-icon map"><Map size={22} /></span>地图</button>
              <button onClick={() => setPhoneTab("camera")}><span className="app-icon camera"><Camera size={22} /></span>相机</button>
              <button onClick={() => setPhoneTab("gallery")}><span className="app-icon gallery"><GalleryHorizontalEnd size={22} /></span>相册</button>
              <button onClick={() => setPhoneTab("translate")}><span className="app-icon translate"><Languages size={22} /></span>翻译</button>
            </div></div>}
            {phoneTab === "map" && <div className="phone-app map-app"><AppTitle onBack={() => setPhoneTab("home")}>离线地图</AppTitle><div className="map-canvas"><svg viewBox="0 0 260 360" aria-label="离线山谷地图"><path d="M20 300 C70 270 50 210 115 190 C185 168 155 90 240 55" /><path d="M6 90 C80 110 60 165 126 190 C190 218 183 270 254 292" /><path className="route" d="M42 302 C80 260 74 224 115 190 C142 164 155 125 196 91" /><circle className="you" cx="196" cy="91" r="8" /><circle className="goal" cx="42" cy="302" r="6" /></svg><span className="map-you">你在这里</span><span className="map-goal">旅店</span><div className="map-distance">预计步行 3小时42分<br /><strong>日落 18:23</strong></div></div>{scene === "dusk" && !mapSeen && <button className="phone-confirm" onClick={() => { setMapSeen(true); setPhoneOpen(false); }}>我走错了整整一座山</button>}</div>}
            {phoneTab === "camera" && <div className="phone-app camera-app"><div className="camera-preview"><div className="focus-box" /></div><button className="shutter" onClick={() => takePhoto(scene === "mailbox" ? "letter" : scene)} aria-label="拍照" /></div>}
            {phoneTab === "gallery" && <div className="phone-app gallery-app"><AppTitle onBack={() => setPhoneTab("home")}>最近项目</AppTitle>{photos.length === 0 ? <div className="empty-gallery"><GalleryHorizontalEnd size={34} /><span>还没有照片</span></div> : <div className="photo-grid">{photos.map(photo => <button key={photo} className="photo-thumb" onClick={() => photo === "letter" && setPhoneTab("translate")}><span>{photo === "letter" ? "崖边的信" : "山谷"}</span></button>)}</div>}{scene === "recovered" && photos.includes("letter") && <button className="phone-confirm" onClick={() => setPhoneTab("translate")}>试着翻译那封信</button>}</div>}
            {phoneTab === "translate" && <div className="phone-app translate-app"><AppTitle onBack={() => setPhoneTab("home")}>图像翻译</AppTitle>{!photos.includes("letter") ? <div className="empty-gallery"><Languages size={34} /><span>没有可翻译的图片</span></div> : scene !== "recovered" ? <div className="signal-error"><span>!</span><p>无网络连接<br /><small>请稍后重试</small></p></div> : <div className="translation-result"><p className="original">Non tutto ciò che si perde desidera essere trovato.</p><div className="translation-divider"><Sparkles size={15} /> 已识别</div><p>不是所有失去的东西，<br />都希望被找到。</p><p>山谷只归还<br />你已经能够带走的。</p><button className="phone-confirm" onClick={() => { setTranslated(true); setPhoneOpen(false); }}>记住这句话</button></div>}</div>}
          </div><div className="phone-homebar" />
        </div>
      </div>}
      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}

function AppTitle({ onBack, children }: { onBack: () => void; children: React.ReactNode }) {
  return <div className="app-title"><button onClick={onBack} aria-label="返回">‹</button><span>{children}</span></div>;
}
