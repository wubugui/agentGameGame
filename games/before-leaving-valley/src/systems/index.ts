import type { System } from "../engine/world";
import { AudioSystem } from "./AudioSystem";
import { BodySystem } from "./BodySystem";
import { CameraBodySystem } from "./CameraBodySystem";
import { ClockSystem } from "./ClockSystem";
import { DialogueSystem } from "./DialogueSystem";
import { GazeSystem } from "./GazeSystem";
import { InteractionSystem } from "./InteractionSystem";
import { InventorySystem } from "./InventorySystem";
import { JournalSystem } from "./JournalSystem";
import { PowerSystem } from "./PowerSystem";
import { SaveSystem } from "./SaveSystem";
import { TriggerSystem } from "./TriggerSystem";
import { UISystem } from "./UISystem";

/** No DOM, no audio, no three: these run in Node for the headless replay. */
export const coreSystems = (): System[] => [UISystem, GazeSystem, InteractionSystem, ClockSystem, BodySystem, PowerSystem, InventorySystem, JournalSystem, TriggerSystem, SaveSystem, DialogueSystem];
export const browserSystems = (): System[] => [...coreSystems(), AudioSystem, CameraBodySystem];
