import { createRoot } from "react-dom/client";
import { App } from "./app/App.tsx";

// Benign browser warning, not an actual error: suppress before Bun's dev
// overlay can pick it up (fires on table/layout reflows after re-renders,
// e.g. saving a project refreshes the list).
window.addEventListener(
  "error",
  (event) => {
    if (event.message?.includes("ResizeObserver loop")) {
      event.stopImmediatePropagation();
      event.preventDefault();
    }
  },
  true,
);

createRoot(document.getElementById("root")!).render(<App />);
