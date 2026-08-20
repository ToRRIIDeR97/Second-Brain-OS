import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { reportRendererDiagnostic } from "./lib/diagnostics";
import "./styles/reference-workbench.css";

window.addEventListener("error", (event) => {
  reportRendererDiagnostic("window.error", event.error ?? event.message);
});

window.addEventListener("unhandledrejection", (event) => {
  reportRendererDiagnostic("window.unhandledrejection", event.reason);
});

const root = document.getElementById("root");

if (!root) throw new Error("Missing #root");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
