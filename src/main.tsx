import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import posthog from "posthog-js";
import "./index.css";
import App from "./App.tsx";

posthog.init("phc_lecJvjlVF93FB9e18yGF6YekOOv531ySnqxNPw6SfTa", {
  api_host: "https://us.i.posthog.com",
  autocapture: false,
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
