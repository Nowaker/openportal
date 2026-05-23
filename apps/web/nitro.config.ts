import { defineConfig } from "nitro";

export default defineConfig({
  serverDir: ".",
  preset: "bun",
  apiDir: "./src/server",
  plugins: [
    "./src/server/plugins/portal-layout-init.ts",
    "./src/server/plugins/build-id-header.ts",
    "./src/server/plugins/presence-tracker-hook.ts",
    "./src/server/plugins/auto-approve-worker.ts",
    "./src/server/plugins/pending-prompt-worker.ts",
    "./src/server/plugins/indicator-broadcaster.ts",
    "./src/server/plugins/session-prefetcher.ts",
    "./src/server/plugins/stuck-detector-client.ts",
    "./src/server/plugins/stuck-detector-journal-client.ts",
  ],
  handlers: [
    {
      route: "/assets/**",
      handler: "./src/middleware/asset-fallback.ts",
    },
    {
      route: "/opencode/**",
      handler: "./src/middleware/opencode-compat.ts",
    },
  ],
  errorHandler: "./src/server/error.ts",
  routeRules: {
    // SPA fallback HTML must never be cached: every navigation to
    // the app needs the freshest index.html so the browser uses
    // the current build's hashed asset references. Hashed
    // /assets/* files are immutable (handled by another route
    // rule baked into the Nitro static handler) and stay
    // cacheable for the full year.
    "/": { headers: { "cache-control": "no-store, must-revalidate" } },
  },
  // Co-located *.test.ts files live next to their modules under
  // src/server/. Without this exclusion Nitro registers them as
  // routes (they don't export defineHandler, so they're silent
  // no-ops at runtime, but still bundle into the prod output).
  ignore: ["**/*.test.ts", "**/*.spec.ts"],
});
