import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { bootWorld } from "./boot";
import GameRoot from "./view/GameRoot";
import "./styles.css";
import "./pano.css";
import "./motion.css";
import "./phone.css";
import "./hud.css";
import "./view/view.css";

// The world lives as long as the page, like an engine's game instance. React only views it.
const world = bootWorld();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <GameRoot world={world} />
  </StrictMode>,
);
