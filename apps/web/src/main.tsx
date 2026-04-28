import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const STALE_RELOAD_KEY = "opencode-stale-reload";

function reloadOnStaleChunk(reason: string) {
  if (typeof window === "undefined") return;
  const last = Number(sessionStorage.getItem(STALE_RELOAD_KEY) || "0");
  const now = Date.now();
  if (last && now - last < 10_000) {
    console.warn(`[chunk-reload] suppressed (recent reload): ${reason}`);
    return;
  }
  sessionStorage.setItem(STALE_RELOAD_KEY, String(now));
  console.warn(`[chunk-reload] reloading: ${reason}`);
  window.location.reload();
}

if (typeof window !== "undefined") {
  window.addEventListener("vite:preloadError", (event) => {
    event.preventDefault();
    reloadOnStaleChunk("vite:preloadError");
  });
  window.addEventListener("error", (event) => {
    const msg = event.message ?? "";
    if (
      msg.includes("Failed to fetch dynamically imported module") ||
      msg.includes("error loading dynamically imported module") ||
      msg.includes("Importing a module script failed")
    ) {
      event.preventDefault();
      reloadOnStaleChunk(`error event: ${msg}`);
    }
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason as { message?: string } | undefined;
    const msg = reason?.message ?? "";
    if (
      msg.includes("Failed to fetch dynamically imported module") ||
      msg.includes("error loading dynamically imported module") ||
      msg.includes("Importing a module script failed")
    ) {
      event.preventDefault();
      reloadOnStaleChunk(`unhandledrejection: ${msg}`);
    }
  });
}

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
);
