import { definePlugin } from "nitro";
import { useNitroHooks } from "nitro/app";

declare const __OPENPORTAL_BUILD_ID__: string;
declare const __OPENPORTAL_COMMIT_SHA__: string;
declare const __OPENPORTAL_COMMIT_SUBJECT__: string;

// Stamp every API response with X-OpenPortal-Build so the browser can
// detect a server upgrade (the bundle that issued its outstanding fetches
// no longer matches the bundle the server is shipping). The frontend
// compares this header to its own __OPENPORTAL_BUILD_ID__ baked at build
// time; on mismatch it surfaces a "App was updated, please reload" banner.
// We do NOT auto-reload (per user spec) - just notify.
export default definePlugin((_nitroApp) => {
  const hooks = useNitroHooks();
  hooks.hook("response", (event) => {
    if (typeof __OPENPORTAL_BUILD_ID__ === "string") {
      event.headers.set("X-OpenPortal-Build", __OPENPORTAL_BUILD_ID__);
    }
    if (typeof __OPENPORTAL_COMMIT_SHA__ === "string") {
      event.headers.set("X-OpenPortal-Commit-Sha", __OPENPORTAL_COMMIT_SHA__);
    }
    if (typeof __OPENPORTAL_COMMIT_SUBJECT__ === "string") {
      event.headers.set("X-OpenPortal-Commit-Subject", __OPENPORTAL_COMMIT_SUBJECT__);
    }
  });
});
