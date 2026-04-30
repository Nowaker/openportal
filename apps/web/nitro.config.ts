import { defineConfig } from "nitro";

export default defineConfig({
  serverDir: ".",
  preset: "bun",
  apiDir: "./src/server",
  plugins: ["./src/server/plugins/build-id-header.ts"],
});
