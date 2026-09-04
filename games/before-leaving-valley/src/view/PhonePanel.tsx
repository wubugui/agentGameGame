/* Wraps the phone: dispatches from the phone become world commands. */
import Phone from "../Phone";
import { SCENES } from "../engine/scene";
import { lightOf } from "../engine/condition";
import { NODES } from "../story";
import { phoneDispatch } from "../systems/UISystem";
import { useWorldContext, useWorldValue } from "./useWorld";

export function PhonePanel() {
  const world = useWorldContext();
  const open = useWorldValue((s) => s.ui.phoneOpen);
  const tab = useWorldValue((s) => s.ui.phoneTab);
  const phone = useWorldValue((s) => s.phone);
  const sceneId = useWorldValue((s) => s.sceneId);
  const camera = useWorldValue((s) => s.camera);
  const night = useWorldValue((s) => s.clock.day === 1 && lightOf(s) <= 0 && !SCENES[s.sceneId]?.interior);
  const translated = useWorldValue((s) => Boolean(s.flags["bench.translated"]));
  const translatedLines = useWorldValue((s) => Number(s.flags["bench.lines"] ?? 0));
  if (!open) return null;
  const node = (NODES as Record<string, unknown>)[sceneId] ? sceneId as keyof typeof NODES : "meadow";
  return (
    <Phone
      tab={tab}
      setTab={(next) => world.patch("ui", { phoneTab: next })}
      close={() => world.dispatch({ type: "phone:close" })}
      phone={phone}
      dispatch={(action) => phoneDispatch(world, action)}
      node={node}
      place={SCENES[sceneId]?.place ?? ""}
      night={night}
      cameraAim={{ x: camera.aimX, y: camera.aimY }}
      setCameraAim={(aim) => world.patch("camera", { aimX: aim.x, aimY: aim.y })}
      cameraZoom={camera.zoom}
      setCameraZoom={(zoom) => world.patch("camera", { zoom })}
      takePhoto={(snapshot) => world.dispatch({ type: "phone:shoot", snapshot })}
      requestReply={(contactId, kind) => world.dispatch({ type: "phone:send", contact: contactId, text: kind === "text" ? undefined : undefined })}
      letterTranslated={translated}
      translatedLines={translatedLines}
      onTranslate={sceneId === "bench" ? () => world.dispatch({ type: "ui:action", id: "bench:translate" }) : undefined}
      call={undefined}
      onUi={(kind) => world.emit("sfx", { name: kind })}
    />
  );
}
