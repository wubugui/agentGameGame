/* Mounts the phase views over the one world. */
import { useEffect } from "react";
import { applyDevParams } from "../engine/dev";
import type { World } from "../engine/world";
import { Actions } from "./Actions";
import { CreditsScreen } from "./CreditsScreen";
import { DialogueLine } from "./DialogueLine";
import { HUD } from "./HUD";
import { PhonePanel } from "./PhonePanel";
import { SceneView } from "./SceneView";
import { SettingsMenu } from "./SettingsMenu";
import { TitleScreen } from "./TitleScreen";
import { CallSheet } from "./overlays/CallSheet";
import { FindMy } from "./overlays/FindMy";
import { HotelCalls } from "./overlays/HotelCalls";
import { PackCloth } from "./overlays/PackCloth";
import { PaperMap } from "./overlays/PaperMap";
import { Reading } from "./overlays/Reading";
import { Selfie } from "./overlays/Selfie";
import { WorldContext, useWorldValue } from "./useWorld";
import { SCENES } from "../engine/scene";

export default function GameRoot({ world }: { world: World }) {
  useEffect(() => {
    // Once per page. StrictMode re-runs effects; the world must not be re-booted or disposed by a view.
    if (world.rt.booted) return;
    world.rt.booted = true;
    const warped = applyDevParams(world);
    if (!warped) world.emit("world:ready", { save: world.rt.hasSave });
    world.notify();
  }, [world]);
  return (
    <WorldContext.Provider value={world}>
      <Root hasSave={world.rt.hasSave} />
    </WorldContext.Provider>
  );
}

function Root({ hasSave }: { hasSave: boolean }) {
  const phase = useWorldValue((s) => s.phase);
  const menuOpen = useWorldValue((s) => s.ui.menuOpen);
  const overlay = useWorldValue((s) => s.ui.overlay);
  const sceneId = useWorldValue((s) => s.sceneId);
  const travel = useWorldValue((s) => Boolean(s.ui.travel));
  const running = useWorldValue((s) => Boolean(s.ui.travel?.run));
  const motion = useWorldValue((s) => s.settings.motion);
  const breath = useWorldValue((s) => s.body.breath);
  const phoneOpen = useWorldValue((s) => s.ui.phoneOpen);
  const scene = SCENES[sceneId];
  if (phase === "title") return <>{<TitleScreen hasSave={hasSave} />}{menuOpen && <SettingsMenu />}</>;
  if (phase === "complete") return <CreditsScreen />;
  return (
    <main className={`game-shell node-${sceneId} body-${travel ? (running ? "run" : "walk") : scene?.body ?? "stand"} ${travel ? "is-moving" : ""} ${travel && running ? "is-running" : ""} ${motion ? "" : "reduce-motion"} breath-${breath} ${overlay && overlay !== "selfie" ? "overlay-open" : ""} ${phoneOpen ? "phone-open" : ""} ${scene?.interior ? "scene-light-interior" : ""}`}>
      <SceneView />
      <HUD />
      <Actions />
      <DialogueLine />
      {overlay === "pack" && <PackCloth />}
      {overlay === "paperMap" && <PaperMap />}
      {overlay === "reading" && <Reading />}
      {overlay === "call" && <CallSheet />}
      {overlay === "findmy" && <FindMy />}
      {overlay === "hotelCalls" && <HotelCalls />}
      {overlay === "selfie" && <Selfie />}
      <PhonePanel />
      {menuOpen && <SettingsMenu />}
    </main>
  );
}
