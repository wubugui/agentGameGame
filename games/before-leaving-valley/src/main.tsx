import { StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import NightLayerPreview from "./NightLayerPreview";
import "./styles.css";

const isNightLayerPreview = new URLSearchParams(window.location.search).get("preview") === "night";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Suspense fallback={<main className="game-shell loading-screen"><div><span />正在进入山谷</div></main>}>
      {isNightLayerPreview ? <NightLayerPreview /> : <App />}
    </Suspense>
  </StrictMode>,
);
