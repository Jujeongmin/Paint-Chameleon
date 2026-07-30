import { createRoot } from "react-dom/client";
import { GameServerProvider } from "@agent8/gameserver";
import App from "./App";

// No StrictMode: the double-mount cycles the game socket and pointer lock.
createRoot(document.getElementById("root")!).render(
  <GameServerProvider>
    <App />
  </GameServerProvider>
);
