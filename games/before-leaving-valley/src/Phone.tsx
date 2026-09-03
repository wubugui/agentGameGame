import {
  ArrowLeft,
  BatteryMedium,
  Camera,
  ChevronRight,
  Image as ImageIcon,
  Map,
  MessageCircle,
  Minus,
  Navigation,
  Plus,
  Send,
  Share2,
  Signal,
  Wifi,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type Dispatch, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { JourneyScene } from "./PixiJourney";
import { journeySceneIndex, LETTER_LINES_IT, LETTER_LINES_ZH } from "./journeyModel";
import {
  CONTACTS,
  formatGameDate,
  formatGameTime,
  sceneAsset,
  type ContactId,
  type PhoneAction,
  type PhonePhoto,
  type PhoneState,
} from "./phoneModel";

export type PhoneTab = "home" | "messages" | "conversation" | "map" | "camera" | "gallery";

type Aim = { x: number; y: number };

type Props = {
  tab: PhoneTab;
  setTab: (tab: PhoneTab) => void;
  close: () => void;
  phone: PhoneState;
  dispatch: Dispatch<PhoneAction>;
  scene: JourneyScene;
  place: string;
  progress: number;
  cameraAim: Aim;
  setCameraAim: (aim: Aim) => void;
  cameraZoom: number;
  setCameraZoom: (zoom: number) => void;
  lightMode: "off" | "phone" | "flashlight";
  takePhoto: (snapshot?: string) => void;
  requestReply: (contactId: ContactId, kind: "text" | "photo") => void;
  onGalleryViewed?: () => void;
  letterTranslated: boolean;
};

const CONTACT_ORDER: ContactId[] = ["xiaoyu", "mama", "asha"];

export default function Phone({
  tab,
  setTab,
  close,
  phone,
  dispatch,
  scene,
  place,
  progress,
  cameraAim,
  setCameraAim,
  cameraZoom,
  setCameraZoom,
  lightMode,
  takePhoto,
  requestReply,
  onGalleryViewed,
  letterTranslated,
}: Props) {
  const [activeContact, setActiveContact] = useState<ContactId>("xiaoyu");
  const [draft, setDraft] = useState("");
  const [mapZoom, setMapZoom] = useState(1);
  const [selectedPhoto, setSelectedPhoto] = useState<PhonePhoto | null>(null);
  const [sharingPhoto, setSharingPhoto] = useState(false);
  const [shutterFlash, setShutterFlash] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const threadEndRef = useRef<HTMLDivElement>(null);
  const cameraPreviewRef = useRef<HTMLDivElement>(null);
  const time = formatGameTime(phone.minuteOfDay);
  const totalUnread = Object.values(phone.unread).reduce((sum, count) => sum + count, 0);
  const cameraAsset = `${import.meta.env.BASE_URL}${sceneAsset(scene)}`;
  const sceneIndex = journeySceneIndex(scene);
  const ascentProgress = Math.min(1, (sceneIndex + progress) / 5);
  const returnProgress = sceneIndex <= 6 ? ascentProgress : sceneIndex <= 11 ? Math.max(0, 1 - (sceneIndex - 6 + progress) / 5) : scene === "searchRoad" ? .28 + progress * .18 : 0;
  const mapX = 55 + returnProgress * 225;
  const mapY = 409 - returnProgress * 325;

  // 结尾要求她真的回看那张信的照片；若相册里没有信（开发预览），退回到“打开相册”即可。
  const hasLetterPhoto = phone.photos.some((photo) => photo.kind === "letter");
  useEffect(() => {
    if (tab === "conversation") threadEndRef.current?.scrollIntoView({ block: "end" });
    if (tab === "gallery" && (!hasLetterPhoto || selectedPhoto?.kind === "letter")) onGalleryViewed?.();
  }, [phone.threads, tab, activeContact, onGalleryViewed, hasLetterPhoto, selectedPhoto]);

  const openConversation = (contactId: ContactId) => {
    setActiveContact(contactId);
    dispatch({ type: "mark_read", contactId });
    setTab("conversation");
  };

  const submitMessage = (event: FormEvent) => {
    event.preventDefault();
    if (!draft.trim()) return;
    dispatch({ type: "send_message", contactId: activeContact, text: draft });
    requestReply(activeContact, "text");
    setDraft("");
  };

  const sharePhoto = (contactId: ContactId) => {
    if (!selectedPhoto) return;
    dispatch({ type: "send_photo", contactId, photoId: selectedPhoto.id });
    requestReply(contactId, "photo");
    setActiveContact(contactId);
    setSelectedPhoto(null);
    setSharingPhoto(false);
    setTab("conversation");
  };

  const aimCamera = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.min(88, Math.max(12, ((event.clientX - rect.left) / rect.width) * 100));
    const y = Math.min(82, Math.max(18, ((event.clientY - rect.top) / rect.height) * 100));
    setCameraAim({ x, y });
  };

  const shoot = async () => {
    if (capturing) return;
    setCapturing(true);
    setShutterFlash(true);
    const preview = cameraPreviewRef.current;
    const snapshot = preview ? await captureCameraFrame(cameraAsset, cameraAim, cameraZoom, preview.clientWidth, preview.clientHeight, scene, lightMode) : undefined;
    takePhoto(snapshot);
    window.setTimeout(() => setShutterFlash(false), 150);
    setCapturing(false);
  };

  const latestPhoto = phone.photos[0];
  const activeThread = phone.threads[activeContact];
  const activeInfo = CONTACTS[activeContact];

  return (
    <div className="phone-overlay" role="dialog" aria-label="林知夏的手机" aria-modal="true">
      <button className="phone-backdrop" onClick={close} aria-label="收起手机" />
      <div className="phone-case" aria-label="鼠尾草绿色透明手机壳，贴着山形贴纸和旧车票">
        <div className="case-side-button case-side-button-top" />
        <div className="case-side-button case-side-button-bottom" />
        <div className="case-sticker case-sticker-mountain">△</div>
        <div className="case-sticker case-sticker-ticket">DOLOMITI<br />8·20</div>
        <div className="phone-frame">
          <div className="phone-island" />
          <div className="phone-status">
            <span>{time}</span>
            <span><Signal size={12} /><Wifi size={12} />{phone.battery}% <BatteryMedium size={15} /></span>
          </div>
          <button className="phone-close" onClick={close} aria-label="收起手机"><X size={17} /></button>
          <div className="phone-content">
            {tab === "home" && (
              <div className="phone-home">
                <div className="wallpaper-sun" />
                <div className="wallpaper-ridge ridge-back" />
                <div className="wallpaper-ridge ridge-front" />
                <div className="home-clock">
                  <span>{formatGameDate(phone.date)}</span>
                  <strong>{time}</strong>
                </div>
                <div className="home-widget">
                  <small>今天</small>
                  <span>来都来了</span>
                  <em>{place}</em>
                </div>
                <div className="app-grid">
                  <PhoneApp icon={<MessageCircle />} label="消息" tone="coral" badge={totalUnread} onClick={() => setTab("messages")} />
                  <PhoneApp icon={<Map />} label="地图" tone="green" onClick={() => setTab("map")} />
                  <PhoneApp icon={<Camera />} label="相机" tone="graphite" onClick={() => setTab("camera")} />
                  <PhoneApp icon={<ImageIcon />} label="相册" tone="sand" onClick={() => setTab("gallery")} />
                </div>
                <p className="wallpaper-signature">知夏 · 把偶然也拍下来</p>
              </div>
            )}

            {tab === "messages" && (
              <PhonePage title="消息" back={() => setTab("home")}>
                <div className="message-list">
                  {CONTACT_ORDER.map((contactId) => {
                    const contact = CONTACTS[contactId];
                    const messages = phone.threads[contactId];
                    const last = messages[messages.length - 1];
                    return (
                      <button className="message-contact" key={contactId} onClick={() => openConversation(contactId)}>
                        <Avatar contactId={contactId} />
                        <span className="contact-copy"><strong>{contact.name}</strong><small>{last.text}</small></span>
                        <span className="contact-meta"><time>{formatGameTime(last.minute)}</time>{phone.unread[contactId] > 0 && <b>{phone.unread[contactId]}</b>}<ChevronRight size={14} /></span>
                      </button>
                    );
                  })}
                </div>
              </PhonePage>
            )}

            {tab === "conversation" && (
              <PhonePage title={activeInfo.name} subtitle={activeInfo.relation} back={() => setTab("messages")}>
                <div className="chat-layout">
                  <div className="chat-thread">
                    {activeThread.map((message, index) => {
                      const previous = activeThread[index - 1];
                      const showTime = !previous || message.minute - previous.minute >= 3;
                      const attachedPhoto = message.photoId ? phone.photos.find((photo) => photo.id === message.photoId) : undefined;
                      return (
                        <div className={`message-row ${message.direction}`} key={message.id}>
                          {showTime && <time>{formatGameTime(message.minute)}</time>}
                          <div className="message-bubble">
                            {attachedPhoto && <div className="message-photo" style={photoStyle(attachedPhoto)} aria-label={`照片：${attachedPhoto.title}`} />}
                            <p>{message.text}</p>
                          </div>
                        </div>
                      );
                    })}
                    {phone.typing[activeContact] && <div className="typing-row"><span /><span /><span /><small>{activeInfo.name}正在输入</small></div>}
                    <div ref={threadEndRef} />
                  </div>
                  <form className="message-composer" onSubmit={submitMessage}>
                    <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={`发消息给${activeInfo.name}`} aria-label="消息内容" />
                    <button type="submit" disabled={!draft.trim()} aria-label="发送消息"><Send size={16} /></button>
                  </form>
                </div>
              </PhonePage>
            )}

            {tab === "map" && (
              <PhonePage title="离线地图" subtitle="多洛米蒂 · 可离线查看" back={() => setTab("home")}>
                <div className="map-app">
                  <div className="map-toolbar">
                    <button onClick={() => setMapZoom((value) => Math.min(1.7, value + 0.2))} aria-label="放大地图"><Plus size={15} /></button>
                    <button onClick={() => setMapZoom((value) => Math.max(0.9, value - 0.2))} aria-label="缩小地图"><Minus size={15} /></button>
                  </div>
                  <div className="map-viewport">
                    <div className="map-sheet" style={{ transform: `scale(${mapZoom})` }}>
                      <svg viewBox="0 0 320 480" aria-label="步道地图">
                        <path className="contour" d="M-10 80 C60 20 145 38 215 5 S340 30 350 92" />
                        <path className="contour" d="M-30 135 C48 70 145 98 225 54 S342 74 360 132" />
                        <path className="contour" d="M-20 205 C80 134 152 170 242 112 S346 134 360 205" />
                        <path className="contour" d="M-20 286 C70 216 168 252 250 190 S350 226 360 278" />
                        <path className="water" d="M10 455 C84 420 68 354 128 320 C188 286 154 214 226 176 C276 151 258 86 313 42" />
                        <path className="road" d="M-5 400 C68 380 76 330 118 306 C172 276 150 228 218 188" />
                        <path className="trail" d="M55 409 C91 368 83 335 119 306 C153 278 158 236 218 188 C252 160 268 122 280 84" />
                        <path className="walked" style={{ strokeDashoffset: 210 - ascentProgress * 210 }} d="M55 409 C91 368 83 335 119 306 C153 278 158 236 218 188 C252 160 268 122 280 84" />
                        <circle className="origin" cx="55" cy="409" r="5" />
                        <g className="you" transform={`translate(${mapX} ${mapY})`}><circle r="9" /><path d="M0 -4 L4 5 L0 3 L-4 5 Z" /></g>
                      </svg>
                      <span className="map-name map-name-origin">登山学校</span>
                      <span className="map-name map-name-fork">牧道岔口</span>
                      <span className="map-name map-name-view">山顶信箱</span>
                    </div>
                  </div>
                  <div className="map-location-card"><Navigation size={17} /><span><strong>{place}</strong><small>教练画的路线 · 已离线保存</small></span></div>
                </div>
              </PhonePage>
            )}

            {tab === "camera" && (
              <div className="camera-app">
                <div className="camera-preview" ref={cameraPreviewRef} onPointerMove={aimCamera} style={{ backgroundImage: `url("${cameraAsset}")`, backgroundPosition: `${cameraAim.x}% ${cameraAim.y}%`, backgroundSize: `auto ${cameraZoom * 100}%` }}>
                  {scene === "chainTraverse" && <img className="camera-scene-prop camera-chain-prop" src={`${import.meta.env.BASE_URL}art/chain-overlay-v1.webp`} alt="" />}
                  {scene === "roadside" && <img className="camera-scene-prop camera-car-prop" src={`${import.meta.env.BASE_URL}art/rescue-car-cutout-v2.webp`} alt="" />}
                  {(scene === "nightSlope" || scene === "deepForest" || scene === "roadside") && <div className={`camera-night-mask camera-light-${lightMode}`} style={{ "--camera-beam-x": `${cameraAim.x}%`, "--camera-beam-y": `${cameraAim.y}%` } as React.CSSProperties} />}
                  <div className="camera-grid" />
                  <div className="focus-box" style={{ left: `${cameraAim.x}%`, top: `${cameraAim.y}%` }} />
                  {shutterFlash && <div className="shutter-flash" />}
                </div>
                <div className="camera-top"><button onClick={() => setTab("home")} aria-label="返回桌面"><ArrowLeft size={18} /></button><span>实况 · {time}</span><span>{phone.battery}%</span></div>
                <div className="zoom-switch">
                  {[1, 1.35, 1.7].map((zoom) => <button className={Math.abs(cameraZoom - zoom) < 0.05 ? "active" : ""} onClick={() => setCameraZoom(zoom)} key={zoom}>{zoom}×</button>)}
                </div>
                <div className="camera-bottom">
                  <button className="camera-thumbnail" onClick={() => setTab("gallery")} style={photoStyle(latestPhoto)} aria-label="查看最近照片" />
                  <button className="shutter" onClick={shoot} disabled={capturing} aria-label="拍照"><span /></button>
                  <button className="camera-spacer" aria-hidden="true" />
                </div>
              </div>
            )}

            {tab === "gallery" && (
              <PhonePage title={selectedPhoto ? selectedPhoto.title : "这一年"} subtitle={selectedPhoto ? `${selectedPhoto.dateLabel} · ${selectedPhoto.place}` : `${phone.photos.length} 张照片`} back={() => { setSharingPhoto(false); selectedPhoto ? setSelectedPhoto(null) : setTab("home"); }}>
                {selectedPhoto ? (
                  <div className="photo-detail">
                    <div className={`photo-detail-image ${selectedPhoto.kind === "letter" ? "is-letter" : ""}`} style={photoStyle(selectedPhoto)}>
                      {selectedPhoto.kind === "letter" && (
                        <div className="letter-paper" aria-label="信箱里的那张纸" style={{ backgroundImage: `url("${import.meta.env.BASE_URL}art/letter-paper-v1.webp")` }}>
                          {LETTER_LINES_IT.map((line, index) => <p key={`it-${index}`}>{line}</p>)}
                          {letterTranslated
                            ? <div className="letter-zh">{LETTER_LINES_ZH.map((line, index) => <p key={`zh-${index}`}>{line}</p>)}</div>
                            : <div className="letter-note">看不懂。先留着。</div>}
                        </div>
                      )}
                    </div>
                    <div className="photo-detail-meta"><strong>{selectedPhoto.title}</strong><span>{selectedPhoto.dateLabel}{selectedPhoto.minute !== undefined ? ` ${formatGameTime(selectedPhoto.minute)}` : ""}</span><small>{selectedPhoto.place}</small></div>
                    <button className="photo-share-button" onClick={() => setSharingPhoto((value) => !value)}><Share2 size={15} /> 发给朋友</button>
                    {sharingPhoto && <div className="share-sheet"><small>发送这张照片</small>{CONTACT_ORDER.map((contactId) => <button key={contactId} onClick={() => sharePhoto(contactId)}><Avatar contactId={contactId} /><span><strong>{CONTACTS[contactId].name}</strong><small>{CONTACTS[contactId].relation}</small></span></button>)}</div>}
                  </div>
                ) : (
                  <div className="gallery-grid">
                    {phone.photos.map((photo) => <button key={photo.id} className={photo.kind === "letter" ? "is-letter" : undefined} onClick={() => { setSharingPhoto(false); setSelectedPhoto(photo); }} style={photoStyle(photo)} aria-label={`${photo.dateLabel}，${photo.title}`}><span>{photo.kind === "letter" ? "信" : photo.isNew ? formatGameTime(photo.minute ?? phone.minuteOfDay) : photo.dateLabel}</span></button>)}
                  </div>
                )}
              </PhonePage>
            )}
          </div>
          <div className="phone-homebar" />
        </div>
        <div className="case-loop"><span className="bead bead-coral" /><span className="bead bead-cream" /><span className="bead bead-leaf" /><span className="bead bead-cream" /><span className="bead bead-coral" /><i>✿</i></div>
      </div>
    </div>
  );
}

function Avatar({ contactId }: { contactId: ContactId }) {
  const contact = CONTACTS[contactId];
  return <span className={`contact-avatar avatar-${contactId}`}>{contact.avatar}</span>;
}

function PhoneApp({ icon, label, tone, badge = 0, onClick }: { icon: React.ReactNode; label: string; tone: string; badge?: number; onClick: () => void }) {
  return <button onClick={onClick}><span className={`app-icon ${tone}`}>{icon}{badge > 0 && <b>{badge}</b>}</span><small>{label}</small></button>;
}

function PhonePage({ title, subtitle, back, children }: { title: string; subtitle?: string; back: () => void; children: React.ReactNode }) {
  return <div className="phone-page"><div className="app-title"><button onClick={back} aria-label="返回"><ArrowLeft size={18} /></button><span><strong>{title}</strong>{subtitle && <small>{subtitle}</small>}</span></div>{children}</div>;
}

function photoStyle(photo: PhonePhoto | undefined) {
  if (!photo) return undefined;
  if (photo.snapshot) return {
    backgroundImage: `url("${photo.snapshot}")`,
    backgroundPosition: "center",
    backgroundSize: "cover",
  };
  return {
    backgroundImage: `url("${import.meta.env.BASE_URL}${photo.asset}")`,
    backgroundPosition: `${photo.position.x}% ${photo.position.y}%`,
    backgroundSize: `auto ${photo.zoom * 100}%`,
  };
}

async function loadCameraImage(asset: string) {
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("camera source failed to load"));
    image.src = asset;
  });
  return image;
}

async function captureCameraFrame(asset: string, aim: Aim, zoom: number, previewWidth: number, previewHeight: number, scene: JourneyScene, lightMode: "off" | "phone" | "flashlight") {
  try {
    const image = await loadCameraImage(asset);

    const outputWidth = 600;
    const outputHeight = Math.max(800, Math.round(outputWidth * previewHeight / Math.max(1, previewWidth)));
    const canvas = document.createElement("canvas");
    canvas.width = outputWidth;
    canvas.height = outputHeight;
    const context = canvas.getContext("2d");
    if (!context) return undefined;

    const drawnHeight = outputHeight * zoom;
    const drawnWidth = drawnHeight * image.naturalWidth / image.naturalHeight;
    const offsetX = (outputWidth - drawnWidth) * aim.x / 100;
    const offsetY = (outputHeight - drawnHeight) * aim.y / 100;
    context.drawImage(image, offsetX, offsetY, drawnWidth, drawnHeight);

    if (scene === "chainTraverse") {
      const chain = await loadCameraImage(`${import.meta.env.BASE_URL}art/chain-overlay-v1.webp`);
      context.drawImage(chain, -outputWidth * .08, outputHeight * .19, outputWidth * .78, outputHeight * .28);
    }
    if (scene === "roadside") {
      const car = await loadCameraImage(`${import.meta.env.BASE_URL}art/rescue-car-cutout-v2.webp`);
      context.drawImage(car, outputWidth * .44, outputHeight * .45, outputWidth * .66, outputHeight * .45);
    }
    if (scene === "nightSlope" || scene === "deepForest" || scene === "roadside") {
      context.save();
      if (lightMode === "off") {
        context.fillStyle = "rgba(0,3,8,.94)";
      } else {
        const centerX = outputWidth * aim.x / 100;
        const centerY = outputHeight * aim.y / 100;
        const radius = outputWidth * (lightMode === "phone" ? .25 : .43);
        const darkness = context.createRadialGradient(centerX, centerY, radius * .08, centerX, centerY, radius);
        darkness.addColorStop(0, "rgba(0,3,8,.02)");
        darkness.addColorStop(.42, lightMode === "phone" ? "rgba(4,10,15,.32)" : "rgba(5,9,11,.16)");
        darkness.addColorStop(1, "rgba(0,3,8,.92)");
        context.fillStyle = darkness;
      }
      context.fillRect(0, 0, outputWidth, outputHeight);
      context.restore();
    }
    return canvas.toDataURL("image/webp", 0.82);
  } catch {
    return undefined;
  }
}
