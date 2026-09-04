/* The fourteen things she carried, from the account. */
import type { ItemId } from "../engine/types";

export type ItemDef = { id: ItemId; name: string; note: string; wear?: boolean; hand?: boolean; sprite: string };

export const ITEMS: Record<ItemId, ItemDef> = {
  helmet: { id: "helmet", name: "白色头盔", note: "CAMP 的，带子有点旧。", wear: true, sprite: "sprites/item-helmet.webp" },
  lanyard: { id: "lanyard", name: "飞拉达挽索", note: "蓝色 Y 形，一把蓝锁一把橙锁。", wear: true, sprite: "sprites/item-lanyard.webp" },
  gloves: { id: "gloves", name: "露指手套", note: "黄绿色，掌心磨薄了。", wear: true, sprite: "sprites/item-gloves.webp" },
  backpack: { id: "backpack", name: "背包", note: "深蓝绿。", wear: true, sprite: "sprites/item-backpack.webp" },
  cap: { id: "cap", name: "棒球帽", note: "米色。", wear: true, sprite: "sprites/item-cap.webp" },
  camera360: { id: "camera360", name: "全景相机", note: "Insta360 X4，夹在肩带上。", hand: true, sprite: "sprites/item-camera360.webp" },
  phone: { id: "phone", name: "手机", note: "这一年所有的照片都在里面。", hand: true, sprite: "sprites/item-phone.webp" },
  fillLight: { id: "fillLight", name: "补光灯", note: "拍视频用的。带了。", hand: true, sprite: "sprites/item-filllight.webp" },
  chocolate: { id: "chocolate", name: "一板巧克力", note: "今天唯一的一顿。", hand: true, sprite: "sprites/item-chocolate.webp" },
  paperMap: { id: "paperMap", name: "纸地图", note: "Tabacco 05 · Gruppo del Sella。背面是本子。", hand: true, sprite: "sprites/item-map.webp" },
  pencil: { id: "pencil", name: "半截铅笔", note: "夹在折缝里。", hand: true, sprite: "sprites/item-pencil.webp" },
  notebook: { id: "notebook", name: "本子", note: "地图的背面。", hand: true, sprite: "sprites/item-notebook.webp" },
  redJacket: { id: "redJacket", name: "红色冲锋衣", note: "Trespass。", wear: true, sprite: "sprites/item-jacket.webp" },
  letterPhoto: { id: "letterPhoto", name: "那一页的照片", note: "28/07/2025。只有这部手机拍下了它。", sprite: "sprites/item-letter.webp" },
  contactCard: { id: "contactCard", name: "他们写的纸", note: "一个意大利号码，一个西班牙号码。", hand: true, sprite: "sprites/item-card.webp" },
};

export const WEARABLE_ORDER: ItemId[] = ["cap", "helmet", "lanyard", "gloves", "redJacket"];
export const HANDHELD_ORDER: ItemId[] = ["paperMap", "pencil", "notebook", "camera360", "phone", "fillLight", "chocolate", "contactCard", "letterPhoto"];
