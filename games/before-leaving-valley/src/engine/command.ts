/* Everything the player can do is a Command. UI produces commands; the headless replay produces the same commands. */
import type { ContactId } from "../phoneModel";
import type { GameSettings } from "../settings";
import type { EntityId, FlagValue, ItemId, OverlayId, PhoneTab, SceneId, Verb } from "./types";

export type Command =
  | { type: "interact"; entity: EntityId; verb: Verb }
  | { type: "hold:start"; entity: EntityId }
  | { type: "hold:end" }
  | { type: "travel"; entity: EntityId }
  | { type: "wait" }
  | { type: "pack:open" } | { type: "pack:close" }
  | { type: "pack:equip"; item: ItemId } | { type: "pack:stow"; item: ItemId }
  | { type: "item:use"; item: ItemId }
  | { type: "lamp:mode"; mode: "wide" | "narrow" }
  | { type: "phone:open"; tab?: PhoneTab } | { type: "phone:close" }
  | { type: "phone:shoot"; snapshot?: string }
  | { type: "phone:send"; contact: ContactId; text?: string; photoId?: string; kind?: "text" | "photo" }
  | { type: "overlay:open"; id: OverlayId; data?: Record<string, FlagValue> } | { type: "overlay:close" }
  | { type: "ui:action"; id: string; value?: FlagValue }
  | { type: "shout" } | { type: "growl:start" } | { type: "growl:end" }
  | { type: "settings"; patch: Partial<GameSettings> }
  | { type: "menu"; open: boolean }
  | { type: "flow"; action: "begin" | "continue" | "title" | "credits:skip" | "complete" }
  | { type: "dev:warp"; scene: SceneId };

export type CommandType = Command["type"];
export type CommandOf<T extends CommandType> = Extract<Command, { type: T }>;
export type CommandHandler<T extends CommandType> = (command: CommandOf<T>) => void;
