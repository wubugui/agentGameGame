/* A decorative entity placed on the painting. The wrapper is projected; only the image inside may animate. */
import type { EntityView } from "../engine/entity";

export function PropSprite({ view }: { view: EntityView }) {
  if (!view.sprite) return null;
  const height = view.sprite.sizeVh ? `${view.sprite.sizeVh * (view.transform.distance ?? 10) / 10}vh` : undefined;
  return (
    <span className={`prop-item ${view.sprite.className} ${view.className ?? ""}`} data-yaw={view.transform.yaw} data-pitch={view.transform.pitch} data-distance={view.transform.distance ?? 10} data-entity={view.id} aria-hidden="true" style={height ? { height } : undefined}>
      <img src={`${import.meta.env.BASE_URL}${view.sprite.src}`} alt="" draggable={false} style={height ? { height } : undefined} />
    </span>
  );
}
