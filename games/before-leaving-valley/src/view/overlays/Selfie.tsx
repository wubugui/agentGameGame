/* The 360 selfie on the summit: a little planet. */
import { SCENES } from "../../engine/scene";
import { useWorldValue } from "../useWorld";

export function Selfie() {
  const sceneId = useWorldValue((s) => s.sceneId);
  return <div className="selfie-flash" aria-hidden="true"><div className="selfie-planet" style={{ backgroundImage: `url("${import.meta.env.BASE_URL}${SCENES[sceneId]?.painting ?? "pano/08-summit.webp"}")` }} /></div>;
}
