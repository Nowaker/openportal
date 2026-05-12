import { defineConfig } from "nitro";

export default defineConfig({
  serverDir: ".",
  preset: "bun",
  apiDir: "./src/server",
  plugins: ["./src/server/plugins/build-id-header.ts"],
  // Co-located *.test.ts files live next to their modules under
  // src/server/. Without this exclusion Nitro registers them as
  // routes (they don't export defineHandler, so they're silent
  // no-ops at runtime, but still bundle into the prod output).
  ignore: ["**/*.test.ts", "**/*.spec.ts"],
});
