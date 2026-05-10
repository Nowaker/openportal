#!/usr/bin/env bun
// Config-aware bootstrap for the bundled Portal web server.
//
// Reads ~/.openportal/openportal.json (falling back to the legacy
// ~/.openportal.json), pulls `web.port` / `web.hostname` out of it,
// sets the corresponding env vars iff they're not already in the
// environment, then imports the Nitro bundle which proceeds to read
// PORT / HOST as usual.
//
// Precedence (most specific wins):
//   PORT env var > web.port in config > Nitro default
//   HOST env var > web.hostname in config > Nitro default
//
// Use this instead of `bun .output/server/index.mjs` directly when
// you want the Portal to honour the config file's web bind settings.
// The `openportal` CLI already wires this via Bun.spawn; this script
// is for the "run the bundle by hand" case.

import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const CONFIG_PATHS = [
  join(homedir(), ".openportal", "openportal.json"),
  join(homedir(), ".openportal.json"),
];

// String-aware JSONC stripper. Same as the helper in
// portal-config.ts / server-registry.ts / cli/index.ts. Three copies
// is bad and tracked as a follow-up — for the bootstrap we keep it
// inline so this script has zero dependencies and can run before
// node_modules are even reachable.
function stripJsoncComments(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const next = i + 1 < n ? src[i + 1] : "";
    if (c === '"') {
      out += c;
      i++;
      while (i < n) {
        const ch = src[i];
        out += ch;
        if (ch === "\\" && i + 1 < n) {
          out += src[i + 1];
          i += 2;
          continue;
        }
        i++;
        if (ch === '"') break;
      }
    } else if (c === "/" && next === "/") {
      while (i < n && src[i] !== "\n") i++;
    } else if (c === "/" && next === "*") {
      i += 2;
      while (i + 1 < n && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

function readConfig() {
  for (const path of CONFIG_PATHS) {
    if (!existsSync(path)) continue;
    try {
      const raw = readFileSync(path, "utf-8");
      return JSON.parse(stripJsoncComments(raw));
    } catch (e) {
      console.warn(
        `[openportal-launch] Failed to read ${path}:`,
        e instanceof Error ? e.message : e,
      );
      return {};
    }
  }
  return {};
}

const cfg = readConfig();
const webCfg = cfg?.web ?? {};

// Apply config-as-default. We DON'T overwrite an env var already set
// by the launching shell — that's what makes env take precedence.
if (!process.env.PORT && typeof webCfg.port === "number") {
  process.env.PORT = String(webCfg.port);
  process.env.NITRO_PORT = process.env.NITRO_PORT ?? String(webCfg.port);
}
if (!process.env.HOST && typeof webCfg.hostname === "string" && webCfg.hostname) {
  process.env.HOST = webCfg.hostname;
  process.env.NITRO_HOST = process.env.NITRO_HOST ?? webCfg.hostname;
}

// Now hand off to the actual bundle. Resolved relative to this file
// so the script is location-independent inside the apps/web tree.
const target = join(__dirname, ".output", "server", "index.mjs");
if (!existsSync(target)) {
  console.error(
    `[openportal-launch] Bundle not found at ${target}. Did you run \`bun run build\` in apps/web?`,
  );
  process.exit(1);
}
await import(target);
