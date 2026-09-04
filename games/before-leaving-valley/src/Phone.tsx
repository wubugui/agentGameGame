/* Her phone, as a phone: lock screen, home with a dock, apps that open from their icon,
   a home indicator you swipe, banners for messages that arrive, no scrollbars, no toys. */
import { ArrowLeft, Battery, BatteryLow, Camera, ChevronRight, Image as ImageIcon, Map, MessageCircle, Minus, Navigation, Phone as PhoneIcon, Plus, Send, Share2, Signal, Wifi } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type Dispatch, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import { LETTER_LINES_IT, LETTER_LINES_ZH, NODES, nodeIndex, type NodeId } from "./story";
import { CONTACTS, formatGameDate, formatGameTime, nodeAsset, type ContactId, type PhoneAction, type PhonePhoto, type PhoneState } from "./phoneModel";

export type PhoneTab = "home" | "messages" | "conversation" | "map" | "camera" | "gallery" | "call";
export type CallState = { lines: readonly string[]; step: number; done: boolean; hangUp: () => void };
type Aim = { x: number; y: number };

type Props = {
  tab: PhoneTab;
  setTab: (tab: PhoneTab) => void;
  close: () => void;
  phone: PhoneState;
  dispatch: Dispatch<PhoneAction>;
  node: NodeId;
  place: string;
  night: boolean;
  cameraAim: Aim;
  setCameraAim: (aim: Aim) => void;
  cameraZoom: number;
  setCameraZoom: (zoom: number) => void;
  takePhoto: (snapshot?: string) => void;
  requestReply: (contactId: ContactId, kind: "text" | "photo") => void;
  onGalleryViewed?: () => void;
  letterTranslated: boolean;
  translatedLines?: number;
  onTranslate?: () => void;
  call?: CallState;
  onUi?: (kind: "tick" | "tock") => void;
};

const CONTACT_ORDER: ContactId[] = ["xiaoyu", "mama", "asha"];
const KEY_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];

export default function Phone({ tab, setTab, close, phone, dispatch, node, place, night, cameraAim, setCameraAim, cameraZoom, setCameraZoom, takePhoto, requestReply, onGalleryViewed, letterTranslated, translatedLines = 0, onTranslate, call, onUi }: Props) {
  // Opening the phone to the home screen means waking it: the lock screen comes first.
  const [locked, setLocked] = useState(tab === "home");
  const [activeContact, setActiveContact] = useState<ContactId>("xiaoyu");
  const [draft, setDraft] = useState("");
  const [composing, setComposing] = useState(false);
  const [mapZoom, setMapZoom] = useState(1);
  const [selectedPhoto, setSelectedPhoto] = useState<PhonePhoto | null>(null);
  const [sharingPhoto, setSharingPhoto] = useState(false);
  const [shutterFlash, setShutterFlash] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [banner, setBanner] = useState<{ contactId: ContactId; text: string; key: number } | null>(null);
  const [swipe, setSwipe] = useState(0);            // live drag of the home indicator, px upward
  const threadEndRef = useRef<HTMLDivElement>(null);
  const cameraPreviewRef = useRef<HTMLDivElement>(null);
  const swipeStartRef = useRef<number | null>(null);
  const lastCountRef = useRef(Object.values(phone.threads).reduce((sum, list) => sum + list.length, 0));
  const time = formatGameTime(phone.minuteOfDay);
  const totalUnread = Object.values(phone.unread).reduce((sum, count) => sum + count, 0);
  const cameraAsset = `${import.meta.env.BASE_URL}${nodeAsset(node)}`;
  const index = nodeIndex(node);
  const summitIndex = nodeIndex("summit");
  const descentEnd = nodeIndex("hairpin");
  const ascentProgress = Math.min(1, Math.max(0, index / summitIndex));
  const returnProgress = index <= summitIndex ? ascentProgress : index <= descentEnd ? Math.max(0, 1 - (index - summitIndex) / (descentEnd - summitIndex)) : node === "search" ? .3 : 0;
  const mapX = 55 + returnProgress * 225;
  const mapY = 409 - returnProgress * 325;
  const lowBattery = phone.battery <= 10;

  const hasLetterPhoto = phone.photos.some((photo) => photo.kind === "letter");
  const dateLabelFor = (photo: PhonePhoto) => {
    if (!photo.isNew || photo.day === undefined) return photo.dateLabel;
    const diff = NODES[node].day - photo.day;
    return diff <= 0 ? "今天" : diff === 1 ? "昨天" : diff === 2 ? "前天" : photo.dateLabel;
  };
  useEffect(() => {
    if (tab === "conversation") threadEndRef.current?.scrollIntoView({ block: "end" });
    if (tab === "gallery" && (!hasLetterPhoto || selectedPhoto?.kind === "letter")) onGalleryViewed?.();
  }, [phone.threads, tab, activeContact, onGalleryViewed, hasLetterPhoto, selectedPhoto]);

  /* A message that lands while another screen is open drops in as a banner. */
  useEffect(() => {
    const count = Object.values(phone.threads).reduce((sum, list) => sum + list.length, 0);
    if (count > lastCountRef.current) {
      let latest: { contactId: ContactId; text: string; minute: number } | null = null;
      CONTACT_ORDER.forEach((contactId) => {
        const message = phone.threads[contactId][phone.threads[contactId].length - 1];
        if (message && message.direction === "incoming" && (!latest || message.minute >= latest.minute)) latest = { contactId, text: message.text, minute: message.minute };
      });
      const hit = latest as { contactId: ContactId; text: string } | null;
      if (hit && !(tab === "conversation" && activeContact === hit.contactId) && !locked) setBanner({ ...hit, key: Date.now() });
    }
    lastCountRef.current = count;
  }, [activeContact, locked, phone.threads, tab]);
  useEffect(() => {
    if (!banner) return;
    const timer = window.setTimeout(() => setBanner(null), 3800);
    return () => window.clearTimeout(timer);
  }, [banner]);

  const unlock = () => { setLocked(false); onUi?.("tick"); };
  const goHome = () => { setSelectedPhoto(null); setSharingPhoto(false); setComposing(false); setTab("home"); onUi?.("tock"); };
  const openApp = (next: PhoneTab) => { onUi?.("tick"); setTab(next); };
  const openConversation = (contactId: ContactId) => { setActiveContact(contactId); dispatch({ type: "mark_read", contactId }); setTab("conversation"); onUi?.("tick"); };

  const submitMessage = (event: FormEvent) => {
    event.preventDefault();
    if (!draft.trim()) return;
    dispatch({ type: "send_message", contactId: activeContact, text: draft });
    requestReply(activeContact, "text");
    setDraft("");
    onUi?.("tick");
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
    const snapshot = preview ? await captureCameraFrame(cameraAsset, cameraAim, cameraZoom, preview.clientWidth, preview.clientHeight, night) : undefined;
    takePhoto(snapshot);
    window.setTimeout(() => setShutterFlash(false), 150);
    setCapturing(false);
  };

  /* The home indicator: drag it up to leave an app; from the home screen it puts the phone away. */
  const swipeDown = (event: ReactPointerEvent) => { swipeStartRef.current = event.clientY; try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* synthetic */ } };
  const swipeMove = (event: ReactPointerEvent) => { if (swipeStartRef.current !== null) setSwipe(Math.max(0, swipeStartRef.current - event.clientY)); };
  const swipeUp = () => {
    const distance = swipe;
    swipeStartRef.current = null;
    setSwipe(0);
    if (distance < 36) { if (locked) unlock(); return; }
    if (locked) { unlock(); return; }
    if (tab === "home") close(); else goHome();
  };

  const latestPhoto = phone.photos[0];
  const activeThread = phone.threads[activeContact];
  const activeInfo = CONTACTS[activeContact];
  const lockNotifications = useMemo(() => CONTACT_ORDER.flatMap((contactId) => phone.unread[contactId] > 0 ? phone.threads[contactId].slice(-phone.unread[contactId]).map((message) => ({ contactId, message })) : []).slice(-4), [phone.threads, phone.unread]);
  const inCall = tab === "call";
  const screenClass = locked && !inCall ? "lock" : tab;

  return (
    <div className="phone-overlay" role="dialog" aria-label="叉宝的手机" aria-modal="true">
      <button className="phone-backdrop" onClick={close} aria-label="收起手机" />
      <div className={`phone-case ${night ? "at-night" : ""}`}>
        <div className="case-side-button case-side-button-silent" />
        <div className="case-side-button case-side-button-up" />
        <div className="case-side-button case-side-button-down" />
        <div className="case-side-button case-side-button-power" />
        <div className="phone-frame">
          <div className="phone-island" />
          <div className={`phone-status ${screenClass === "camera" ? "on-dark" : ""} ${screenClass === "lock" || screenClass === "home" ? "on-wallpaper" : ""}`}>
            <span className="status-time">{time}</span>
            <span className="status-icons"><Signal size={12} /><Wifi size={12} /><i className={`status-battery ${lowBattery ? "low" : ""}`}>{phone.battery}%</i>{lowBattery ? <BatteryLow size={16} /> : <Battery size={16} />}</span>
          </div>

          {banner && (
            <div className="phone-banner" key={banner.key} onClick={() => { setBanner(null); openConversation(banner.contactId); }}>
              <Avatar contactId={banner.contactId} />
              <span><strong>{CONTACTS[banner.contactId].name}</strong><small>{banner.text}</small></span>
              <em>现在</em>
            </div>
          )}

          <div className="phone-content" style={{ translate: `0 ${-Math.min(swipe, 60) * 0.35}px`, scale: `${1 - Math.min(swipe, 60) * 0.0012}` } as React.CSSProperties}>
            {screenClass === "lock" && (
              <div className="lock-screen" onClick={unlock}>
                <div className="wallpaper"><div className="wallpaper-sun" /><div className="wallpaper-ridge ridge-back" /><div className="wallpaper-ridge ridge-front" /></div>
                <div className="lock-clock"><span>{formatGameDate(phone.date)}</span><strong>{time}</strong></div>
                <div className="lock-notifications">
                  {lockNotifications.length === 0 && lowBattery && <div className="lock-card system"><span className="lock-card-icon"><BatteryLow size={16} /></span><span><strong>电量不足</strong><small>剩余 {phone.battery}%</small></span></div>}
                  {lockNotifications.map(({ contactId, message }) => (
                    <div className="lock-card" key={message.id}><Avatar contactId={contactId} /><span><strong>{CONTACTS[contactId].name}</strong><small>{message.text}</small></span><em>{formatGameTime(message.minute)}</em></div>
                  ))}
                </div>
                <div className="lock-quick"><span className="quick-button"><PhoneIcon size={18} /></span><span className="quick-button"><Camera size={18} /></span></div>
                <p className="lock-hint">向上滑动以解锁</p>
              </div>
            )}

            {screenClass === "home" && (
              <div className="home-screen">
                <div className="wallpaper"><div className="wallpaper-sun" /><div className="wallpaper-ridge ridge-back" /><div className="wallpaper-ridge ridge-front" /></div>
                <div className="home-widget">
                  <div className="widget-weather"><small>{place.split(" · ")[0]}</small><strong>{NODES[node].light === "night" ? "9°" : NODES[node].elevation.startsWith("2,9") ? "6°" : "14°"}</strong><span>{night ? "夜间 · 晴" : NODES[node].light === "dusk" ? "傍晚 · 多云" : "多云"}</span></div>
                  <div className="widget-note"><small>备忘录</small><span>来都来了</span><em>{formatGameDate(phone.date)}</em></div>
                </div>
                <div className="home-page-dots"><i className="on" /><i /></div>
                <div className="home-dock">
                  <PhoneApp icon={<MessageCircle />} label="信息" tone="coral" badge={totalUnread} onClick={() => openApp("messages")} />
                  <PhoneApp icon={<Map />} label="地图" tone="green" onClick={() => openApp("map")} />
                  <PhoneApp icon={<Camera />} label="相机" tone="graphite" onClick={() => openApp("camera")} />
                  <PhoneApp icon={<ImageIcon />} label="照片" tone="sand" onClick={() => openApp("gallery")} />
                </div>
              </div>
            )}

            {inCall && (
              <div className="app-screen call-screen" role="dialog" aria-label="求助电话">
                <div className="call-avatar"><PhoneIcon size={26} /></div>
                <div className="call-number">112</div>
                <div className="call-status">{call ? (call.done ? "通话结束" : call.step === 0 ? "正在呼叫…" : "通话中 · 信号弱") : "已挂断"}</div>
                <div className="call-lines">{call && call.lines.slice(0, call.step + 1).map((line, index) => <p key={index} className={index === 2 ? "mine" : ""}>{line}</p>)}</div>
                <div className="call-actions"><button className="call-hangup" onClick={() => call?.hangUp()} disabled={!call || !call.done} aria-label="挂断"><PhoneIcon size={24} /></button></div>
              </div>
            )}

            {screenClass === "messages" && (
              <AppScreen title="信息" back={goHome}>
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
              </AppScreen>
            )}

            {screenClass === "conversation" && (
              <AppScreen title={activeInfo.name} subtitle={activeInfo.relation} back={() => { setComposing(false); setTab("messages"); }} avatar={<Avatar contactId={activeContact} />}>
                <div className={`chat-layout ${composing ? "keyboard-up" : ""}`}>
                  <div className="chat-thread">
                    {activeThread.map((message, index) => {
                      const previous = activeThread[index - 1];
                      const showTime = !previous || previous.minute > message.minute || message.minute - previous.minute >= 3;
                      const attachedPhoto = message.photoId ? phone.photos.find((photo) => photo.id === message.photoId) : undefined;
                      const isLast = index === activeThread.length - 1;
                      return (
                        <div className={`message-row ${message.direction}`} key={message.id}>
                          {showTime && <time>{formatGameTime(message.minute)}</time>}
                          <div className="message-bubble">
                            {attachedPhoto && <div className="message-photo" style={photoStyle(attachedPhoto)} aria-label={`照片：${attachedPhoto.title}`} />}
                            {message.text && <p>{message.text}</p>}
                          </div>
                          {isLast && message.direction === "outgoing" && <small className="delivered">已送达</small>}
                        </div>
                      );
                    })}
                    {phone.typing[activeContact] && <div className="typing-row"><span /><span /><span /></div>}
                    <div ref={threadEndRef} />
                  </div>
                  <form className="message-composer" onSubmit={submitMessage}>
                    <input value={draft} onChange={(event) => setDraft(event.target.value)} onFocus={() => setComposing(true)} placeholder="信息" aria-label="消息内容" />
                    <button type="submit" disabled={!draft.trim()} aria-label="发送消息"><Send size={14} /></button>
                  </form>
                  {composing && (
                    <div className="phone-keyboard" aria-hidden="true">
                      {KEY_ROWS.map((row, rowIndex) => (
                        <div className={`key-row row-${rowIndex}`} key={row}>{row.split("").map((key) => <button type="button" key={key} tabIndex={-1} onPointerDown={(event) => { event.preventDefault(); setDraft((value) => value + key); }}>{key}</button>)}</div>
                      ))}
                      <div className="key-row row-3"><button type="button" tabIndex={-1} className="key-wide" onPointerDown={(event) => { event.preventDefault(); setDraft((value) => value.slice(0, -1)); }}>⌫</button><button type="button" tabIndex={-1} className="key-space" onPointerDown={(event) => { event.preventDefault(); setDraft((value) => value + " "); }}>空格</button><button type="button" tabIndex={-1} className="key-wide" onPointerDown={(event) => { event.preventDefault(); setComposing(false); }}>收起</button></div>
                    </div>
                  )}
                </div>
              </AppScreen>
            )}

            {screenClass === "map" && (
              <AppScreen title="地图" subtitle="离线地图 · 多洛米蒂" back={goHome}>
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
                        <g className="you" transform={`translate(${mapX} ${mapY})`}><circle className="you-halo" r="18" /><circle r="7" /></g>
                      </svg>
                      <span className="map-name map-name-origin">Passo Sella 公交站</span>
                      <span className="map-name map-name-fork">Val Lasties 岔口</span>
                      <span className="map-name map-name-view">半途的信箱</span>
                    </div>
                  </div>
                  <div className="map-location-card"><Navigation size={17} /><span><strong>{place}</strong><small>Pössnecker · 已离线保存</small></span></div>
                </div>
              </AppScreen>
            )}

            {screenClass === "camera" && (
              <div className="app-screen camera-app">
                <div className="camera-preview" ref={cameraPreviewRef} onPointerMove={aimCamera} style={{ backgroundImage: `url("${cameraAsset}")`, backgroundPosition: `${cameraAim.x}% ${cameraAim.y}%`, backgroundSize: `auto ${cameraZoom * 100}%` }}>
                  {night && <div className="camera-night-mask" style={{ "--camera-beam-x": `${cameraAim.x}%`, "--camera-beam-y": `${cameraAim.y}%` } as React.CSSProperties} />}
                  <div className="camera-grid" />
                  <div className="focus-box" style={{ left: `${cameraAim.x}%`, top: `${cameraAim.y}%` }}><i /></div>
                  {shutterFlash && <div className="shutter-flash" />}
                </div>
                <div className="camera-top"><span className="camera-flash">⚡︎ 自动</span><span className="camera-live">实况</span><span className="camera-ratio">4:3</span></div>
                <div className="zoom-switch">
                  {[1, 1.35, 1.7].map((zoom) => <button className={Math.abs(cameraZoom - zoom) < 0.05 ? "active" : ""} onClick={() => setCameraZoom(zoom)} key={zoom}>{zoom === 1 ? "1×" : zoom === 1.35 ? "2×" : "3×"}</button>)}
                </div>
                <div className="camera-modes"><span>全景</span><span className="active">照片</span><span>视频</span></div>
                <div className="camera-bottom">
                  <button className="camera-thumbnail" onClick={() => openApp("gallery")} style={photoStyle(latestPhoto)} aria-label="查看最近照片" />
                  <button className="shutter" onClick={shoot} disabled={capturing} aria-label="拍照"><span /></button>
                  <button className="camera-flip" onClick={goHome} aria-label="返回主屏幕"><ArrowLeft size={16} /></button>
                </div>
              </div>
            )}

            {screenClass === "gallery" && (
              <AppScreen title={selectedPhoto ? dateLabelFor(selectedPhoto) : "最近项目"} subtitle={selectedPhoto ? `${selectedPhoto.minute !== undefined ? formatGameTime(selectedPhoto.minute) : ""} · ${selectedPhoto.place}` : `${phone.photos.length} 张照片`} back={() => { setSharingPhoto(false); selectedPhoto ? setSelectedPhoto(null) : goHome(); }} dark={Boolean(selectedPhoto)}>
                {selectedPhoto ? (
                  <div className="photo-detail">
                    <div className={`photo-detail-image ${selectedPhoto.kind === "letter" ? "is-letter" : ""}`} style={photoStyle(selectedPhoto)}>
                      {selectedPhoto.kind === "letter" && (
                        <div className="letter-paper" aria-label="信箱里的那张纸" style={{ backgroundImage: `url("${import.meta.env.BASE_URL}art/letter-paper-v1.webp")` }}>
                          {LETTER_LINES_IT.map((line, index) => <p key={`it-${index}`}>{line}</p>)}
                          {(letterTranslated || translatedLines > 0) && (() => {
                            let shown = 0;
                            return <div className="letter-zh">{LETTER_LINES_ZH.map((line, index) => { if (!line) return <p key={`zh-${index}`}> </p>; shown += 1; return <p key={`zh-${index}`} className={letterTranslated || shown <= translatedLines ? "shown" : "pending"}>{letterTranslated || shown <= translatedLines ? line : " "}</p>; })}</div>;
                          })()}
                          {!letterTranslated && (onTranslate
                            ? <button className="letter-translate" onClick={onTranslate}>{translatedLines === 0 ? "翻译" : "下一句"}</button>
                            : null)}
                        </div>
                      )}
                    </div>
                    <div className="photo-toolbar">
                      <button onClick={() => setSharingPhoto((value) => !value)} aria-label="分享"><Share2 size={17} /></button>
                      <span className="photo-caption"><strong>{selectedPhoto.title}</strong><small>{selectedPhoto.place}</small></span>
                    </div>
                    {sharingPhoto && <div className="share-sheet"><small>发送给</small>{CONTACT_ORDER.map((contactId) => <button key={contactId} onClick={() => sharePhoto(contactId)}><Avatar contactId={contactId} /><span><strong>{CONTACTS[contactId].name}</strong><small>{CONTACTS[contactId].relation}</small></span></button>)}</div>}
                  </div>
                ) : (
                  <div className="gallery-grid">
                    {phone.photos.map((photo) => <button key={photo.id} className={photo.kind === "letter" ? "is-letter" : undefined} onClick={() => { setSharingPhoto(false); setSelectedPhoto(photo); onUi?.("tick"); }} style={photoStyle(photo)} aria-label={`${photo.dateLabel}，${photo.title}`} />)}
                  </div>
                )}
              </AppScreen>
            )}
          </div>

          <div className="phone-homebar-zone" onPointerDown={swipeDown} onPointerMove={swipeMove} onPointerUp={swipeUp} onPointerCancel={swipeUp} aria-label={locked ? "向上滑动解锁" : tab === "home" ? "向上滑动收起手机" : "向上滑动回到主屏幕"} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); if (locked) unlock(); else if (tab === "home") close(); else goHome(); } }}>
            <div className={`phone-homebar ${screenClass === "camera" || screenClass === "lock" || screenClass === "home" || inCall || (screenClass === "gallery" && selectedPhoto) ? "on-dark" : ""}`} />
          </div>
        </div>
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

function AppScreen({ title, subtitle, back, avatar, dark = false, children }: { title: string; subtitle?: string; back: () => void; avatar?: React.ReactNode; dark?: boolean; children: React.ReactNode }) {
  return (
    <div className={`app-screen phone-page ${dark ? "dark" : ""}`}>
      <div className="app-title">
        <button onClick={back} aria-label="返回"><ArrowLeft size={18} /></button>
        {avatar}
        <span><strong>{title}</strong>{subtitle && <small>{subtitle}</small>}</span>
      </div>
      {children}
    </div>
  );
}

function photoStyle(photo: PhonePhoto | undefined) {
  if (!photo) return undefined;
  if (photo.snapshot) return { backgroundImage: `url("${photo.snapshot}")`, backgroundPosition: "center", backgroundSize: "cover" };
  return { backgroundImage: `url("${import.meta.env.BASE_URL}${photo.asset}")`, backgroundPosition: `${photo.position.x}% ${photo.position.y}%`, backgroundSize: `auto ${photo.zoom * 100}%` };
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

async function captureCameraFrame(asset: string, aim: Aim, zoom: number, previewWidth: number, previewHeight: number, night: boolean) {
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
    if (night) {
      context.save();
      const centerX = outputWidth * aim.x / 100;
      const centerY = outputHeight * aim.y / 100;
      const radius = outputWidth * .4;
      const darkness = context.createRadialGradient(centerX, centerY, radius * .08, centerX, centerY, radius);
      darkness.addColorStop(0, "rgba(0,3,8,.02)");
      darkness.addColorStop(.42, "rgba(5,9,11,.2)");
      darkness.addColorStop(1, "rgba(0,3,8,.92)");
      context.fillStyle = darkness;
      context.fillRect(0, 0, outputWidth, outputHeight);
      context.restore();
    }
    return canvas.toDataURL("image/webp", 0.82);
  } catch {
    return undefined;
  }
}
