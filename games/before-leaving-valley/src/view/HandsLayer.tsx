/* Her hands: reaching for what she touches, swinging as she walks, resting on her knees in the car, holding the phone. */
import { useEffect, useState } from "react";
import type { Transform } from "../engine/types";
import { useWorldContext, useWorldValue } from "./useWorld";

const WALK_CADENCE = 560;
const RUN_CADENCE = 300;

function Reach() {
  const world = useWorldContext();
  const [hand, setHand] = useState<{ key: number; transform: Transform; kind: "grip" | "carabiner"; hold: boolean } | null>(null);
  useEffect(() => world.on("hand:reach", ({ transform, kind, hold }) => setHand({ key: Date.now(), transform, kind, hold })), [world]);
  if (!hand) return null;
  return <img key={hand.key} className={`hand-reach ${hand.kind} ${hand.hold ? "hold" : ""}`} data-yaw={hand.transform.yaw} data-pitch={hand.transform.pitch} data-distance={8} src={`${import.meta.env.BASE_URL}sprites/hand-${hand.kind}.webp`} alt="" draggable={false} onAnimationEnd={() => setHand((current) => current && current.key === hand.key ? null : current)} />;
}

function Body({ walking, running }: { walking: boolean; running: boolean }) {
  const sceneId = useWorldValue((s) => s.sceneId);
  const phoneOpen = useWorldValue((s) => s.ui.phoneOpen);
  const [leaving, setLeaving] = useState(false);
  const [wasWalking, setWasWalking] = useState(false);
  useEffect(() => {
    if (walking) { setWasWalking(true); setLeaving(false); return; }
    if (wasWalking) { setLeaving(true); const timer = window.setTimeout(() => { setLeaving(false); setWasWalking(false); }, 480); return () => window.clearTimeout(timer); }
  }, [walking, wasWalking]);
  return (
    <>
      <div className="hands-layer" aria-hidden="true">
        {(walking || leaving) && <img className={`hand-walk ${!walking ? "leaving" : ""}`} src={`${import.meta.env.BASE_URL}sprites/hand-walk.webp`} alt="" draggable={false} style={{ "--cadence": `${running ? RUN_CADENCE : WALK_CADENCE}ms` } as React.CSSProperties} />}
        {sceneId === "car" && <img className="hands-lap" src={`${import.meta.env.BASE_URL}sprites/hands-lap.webp`} alt="" draggable={false} />}
      </div>
      {phoneOpen && <img className="hand-phone" src={`${import.meta.env.BASE_URL}sprites/hand-phone.webp`} alt="" draggable={false} aria-hidden="true" />}
    </>
  );
}

export const HandsLayer = { Reach, Body };
