import { JOURNEY_SCENE_INFO, type JourneyScene } from "./journeyModel";

export type ContactId = "xiaoyu" | "mama" | "asha";

export type PhoneMessage = {
  id: string;
  direction: "incoming" | "outgoing";
  text: string;
  minute: number;
  photoId?: string;
};

export type GameDate = {
  year: number;
  month: number;
  day: number;
};

export type PhotoKind = "letter";

export type PhonePhoto = {
  id: string;
  asset: string;
  snapshot?: string;
  title: string;
  place: string;
  dateLabel: string;
  minute?: number;
  position: { x: number; y: number };
  zoom: number;
  isNew?: boolean;
  kind?: PhotoKind;
};

export type PhoneState = {
  date: GameDate;
  minuteOfDay: number;
  battery: number;
  threads: Record<ContactId, PhoneMessage[]>;
  unread: Record<ContactId, number>;
  typing: Record<ContactId, boolean>;
  photos: PhonePhoto[];
};

export type PhoneAction =
  | { type: "advance_time"; minutes: number; batteryCost?: number }
  | { type: "set_clock"; date?: GameDate; minuteOfDay?: number; battery?: number }
  | { type: "send_message"; contactId: ContactId; text: string }
  | { type: "send_photo"; contactId: ContactId; photoId: string; text?: string }
  | { type: "receive_message"; contactId: ContactId; text: string; minute?: number }
  | { type: "set_typing"; contactId: ContactId; value: boolean }
  | { type: "mark_read"; contactId: ContactId }
  | { type: "capture_photo"; photo: Omit<PhonePhoto, "id" | "minute" | "dateLabel" | "isNew"> }
  | { type: "restore"; state: PhoneState }
  | { type: "reset" };

/* 这一天，以及第二天清晨。 */
const JOURNEY_DATE: GameDate = { year: 2026, month: 8, day: 20 };
export const NEXT_MORNING_DATE: GameDate = { year: 2026, month: 8, day: 21 };
const START_MINUTE = 15 * 60 + 12;

export const CONTACTS: Record<ContactId, { name: string; avatar: string; relation: string }> = {
  xiaoyu: { name: "小鱼", avatar: "🐟", relation: "从小一起长大" },
  mama: { name: "妈妈", avatar: "桂", relation: "刚刚在线" },
  asha: { name: "阿夏", avatar: "夏", relation: "伦敦的同学 · 下周也回国" },
};

/* 她在英国的这一年。行李已经寄回去了，照片都在这部手机里。 */
const INITIAL_PHOTOS: PhonePhoto[] = [
  {
    id: "memory-ridge",
    asset: "art/ridge.webp",
    title: "第一次一个人去的山",
    place: "北边的山",
    dateLabel: "6月2日",
    position: { x: 62, y: 48 },
    zoom: 1.08,
  },
  {
    id: "memory-road",
    asset: "art/road.webp",
    title: "错过车以后看到的天",
    place: "回学校的公路",
    dateLabel: "4月18日",
    position: { x: 50, y: 48 },
    zoom: 1.04,
  },
  {
    id: "memory-rain-cafe",
    asset: "art/memory-rain-cafe-v1.webp",
    title: "雨停以前画完的那页",
    place: "伦敦 · 学校旁的咖啡馆",
    dateLabel: "2月11日",
    position: { x: 52, y: 56 },
    zoom: 1.08,
  },
  {
    id: "memory-blue-train",
    asset: "art/memory-blue-train-v1.webp",
    title: "阿夏把最后一瓣橘子给我",
    place: "去北方的慢车",
    dateLabel: "去年11月",
    position: { x: 53, y: 50 },
    zoom: 1.06,
  },
  {
    id: "memory-forest",
    asset: "art/forest.webp",
    title: "说好只走到天黑前",
    place: "校园后面的林子",
    dateLabel: "去年10月",
    position: { x: 46, y: 54 },
    zoom: 1.06,
  },
];

const makeInitialThreads = (): Record<ContactId, PhoneMessage[]> => ({
  xiaoyu: [
    { id: "xy-1", direction: "incoming", text: "你真的一个人去爬山了？", minute: 14 * 60 + 31 },
    { id: "xy-2", direction: "outgoing", text: "嗯！登山学校的教练给我画了路线，说两小时就能登顶", minute: 14 * 60 + 33 },
    { id: "xy-3", direction: "outgoing", text: "看到好看的给你拍 📷", minute: 14 * 60 + 33 },
    { id: "xy-4", direction: "incoming", text: "等你的照片。回国第一顿我请", minute: 14 * 60 + 35 },
  ],
  mama: [
    { id: "ma-1", direction: "incoming", text: "到了给我发个小树，不用打电话。", minute: 12 * 60 + 42 },
    { id: "ma-2", direction: "outgoing", text: "🌲 到啦，天气很好。", minute: 14 * 60 + 58 },
    { id: "ma-3", direction: "incoming", text: "好，玩开心。回来给我看照片。", minute: 14 * 60 + 59 },
  ],
  asha: [
    { id: "ax-1", direction: "incoming", text: "钥匙交了。站在空房间里，忽然有点想哭。", minute: 11 * 60 + 16 },
    { id: "ax-2", direction: "outgoing", text: "我也是。行李都寄回去了，只背了一个包来意大利。", minute: 14 * 60 + 40 },
    { id: "ax-3", direction: "incoming", text: "一年就这么过完了。多拍点，回国一起看。", minute: 14 * 60 + 41 },
  ],
});

export function createInitialPhoneState(): PhoneState {
  return {
    date: { ...JOURNEY_DATE },
    minuteOfDay: START_MINUTE,
    battery: 82,
    threads: makeInitialThreads(),
    unread: { xiaoyu: 0, mama: 0, asha: 0 },
    typing: { xiaoyu: false, mama: false, asha: false },
    photos: INITIAL_PHOTOS.map((photo) => ({ ...photo, position: { ...photo.position } })),
  };
}

export function formatGameTime(minuteOfDay: number) {
  const normalized = ((minuteOfDay % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60).toString().padStart(2, "0");
  const minutes = (normalized % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

export function formatGameDate(date: GameDate) {
  const week = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const weekday = week[new Date(date.year, date.month - 1, date.day).getDay()];
  return `${date.month}月${date.day}日 · ${weekday}`;
}

export function sceneAsset(scene: JourneyScene) {
  return JOURNEY_SCENE_INFO[scene].asset;
}

function messageId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function advanceClock(date: GameDate, minuteOfDay: number, minutes: number) {
  const current = new Date(date.year, date.month - 1, date.day, 0, minuteOfDay);
  current.setMinutes(current.getMinutes() + minutes);
  return {
    date: { year: current.getFullYear(), month: current.getMonth() + 1, day: current.getDate() },
    minuteOfDay: current.getHours() * 60 + current.getMinutes(),
  };
}

export function phoneReducer(state: PhoneState, action: PhoneAction): PhoneState {
  switch (action.type) {
    case "advance_time": {
      const minutes = Math.max(0, Math.round(action.minutes));
      const defaultDrain = minutes > 0 ? Math.max(1, Math.floor(minutes / 9)) : 0;
      const drain = action.batteryCost ?? defaultDrain;
      const clock = advanceClock(state.date, state.minuteOfDay, minutes);
      return {
        ...state,
        ...clock,
        battery: Math.max(0, state.battery - Math.max(0, drain)),
      };
    }
    case "set_clock":
      return {
        ...state,
        date: action.date ? { ...action.date } : state.date,
        minuteOfDay: action.minuteOfDay === undefined ? state.minuteOfDay : Math.max(0, Math.round(action.minuteOfDay)),
        battery: action.battery === undefined ? state.battery : Math.min(100, Math.max(0, Math.round(action.battery))),
      };
    case "send_message": {
      const text = action.text.trim();
      if (!text) return state;
      const message: PhoneMessage = {
        id: messageId("sent"),
        direction: "outgoing",
        text,
        minute: state.minuteOfDay,
      };
      return {
        ...state,
        ...advanceClock(state.date, state.minuteOfDay, 1),
        battery: Math.max(0, state.battery - 1),
        threads: { ...state.threads, [action.contactId]: [...state.threads[action.contactId], message] },
      };
    }
    case "send_photo": {
      if (!state.photos.some((photo) => photo.id === action.photoId)) return state;
      const message: PhoneMessage = {
        id: messageId("photo"),
        direction: "outgoing",
        text: action.text?.trim() || "给你看刚刚拍的。",
        minute: state.minuteOfDay,
        photoId: action.photoId,
      };
      return {
        ...state,
        ...advanceClock(state.date, state.minuteOfDay, 1),
        battery: Math.max(0, state.battery - 1),
        threads: { ...state.threads, [action.contactId]: [...state.threads[action.contactId], message] },
      };
    }
    case "receive_message": {
      const message: PhoneMessage = {
        id: messageId("received"),
        direction: "incoming",
        text: action.text,
        minute: action.minute ?? state.minuteOfDay,
      };
      return {
        ...state,
        threads: { ...state.threads, [action.contactId]: [...state.threads[action.contactId], message] },
        unread: { ...state.unread, [action.contactId]: state.unread[action.contactId] + 1 },
      };
    }
    case "mark_read":
      return { ...state, unread: { ...state.unread, [action.contactId]: 0 } };
    case "set_typing":
      return { ...state, typing: { ...state.typing, [action.contactId]: action.value } };
    case "capture_photo": {
      const photo: PhonePhoto = {
        ...action.photo,
        id: messageId("photo"),
        dateLabel: "今天",
        minute: state.minuteOfDay,
        isNew: true,
      };
      return {
        ...state,
        ...advanceClock(state.date, state.minuteOfDay, 1),
        battery: Math.max(0, state.battery - 2),
        photos: [photo, ...state.photos],
      };
    }
    case "restore":
      return {
        ...action.state,
        date: { ...action.state.date },
        threads: Object.fromEntries(Object.entries(action.state.threads).map(([contactId, messages]) => [contactId, messages.map((message) => ({ ...message }))])) as PhoneState["threads"],
        unread: { ...action.state.unread },
        typing: { xiaoyu: false, mama: false, asha: false },
        photos: action.state.photos.map((photo) => ({ ...photo, position: { ...photo.position } })),
      };
    case "reset":
      return createInitialPhoneState();
  }
}
