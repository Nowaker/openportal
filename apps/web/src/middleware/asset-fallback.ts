import { defineHandler } from "nitro/h3";
import { existsSync, readFileSync, statSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

declare const globalThis: { __nitro_main__?: string } & typeof globalThis;

// Middleware that owns every /assets/*.{js,css} request before Nitro's
// static handler or the SPA fallback can reach for them. Two guarantees,
// always:
//   1. File present on disk under .output/public/assets/ -> served from
//      disk regardless of whether Nitro's in-memory manifest knows
//      about it. The build.sh retention layer keeps prior builds'
//      hashed files on disk for 14 days; without this hop they would
//      fall through to the SPA fallback (1519-byte index.html) and the
//      browser's <script type="module"> tag would reject the response
//      as a MIME mismatch, hard-crashing the page.
//   2. File missing on disk -> 200 with a tiny JS reload shim (or empty
//      CSS for stylesheets) instead of the SPA fallback HTML. The shim
//      triggers a single window.location.reload(), guarded by
//      sessionStorage so a genuinely broken build cannot spin the
//      browser. Combined with the route rule `Cache-Control: no-store`
//      on /, the reloaded HTML references the current build's hashes
//      and the page recovers without manual intervention.
function resolvePublicDir(): string {
  const nitroMain = globalThis.__nitro_main__;
  if (typeof nitroMain === "string" && nitroMain.length > 0) {
    return resolve(dirname(fileURLToPath(nitroMain)), "..", "public");
  }
  return resolve(process.cwd(), ".output/public");
}

const PUBLIC_DIR = resolvePublicDir();
const ASSET_PATH_RE = /^\/assets\/[^?#]+\.(js|css)(?:[?#].*)?$/i;

const RELOAD_SHIM_JS = `console.warn("[openportal] asset hash drift; reloading to pick up latest build");
(function () {
  try {
    var key = "openportal:reload-attempted";
    var now = Date.now();
    var last = parseInt(sessionStorage.getItem(key) || "0", 10);
    if (now - last < 5000) {
      console.error("[openportal] reload loop blocked - build may be broken");
      return;
    }
    sessionStorage.setItem(key, String(now));
  } catch (_e) {}
  location.reload();
})();
`;

const EMPTY_CSS = `/* openportal: missing CSS, ignored; sibling JS shim will reload */
`;

export default defineHandler((event) => {
  const path: string = (event as unknown as { path?: string }).path ?? "";
  const m = ASSET_PATH_RE.exec(path);
  if (!m) return;
  const ext = m[1].toLowerCase();
  const cleanPath = path.split(/[?#]/, 1)[0];
  const filePath = resolve(PUBLIC_DIR, "." + cleanPath);
  const contentType =
    ext === "js"
      ? "application/javascript; charset=utf-8"
      : "text/css; charset=utf-8";

  if (existsSync(filePath)) {
    try {
      if (statSync(filePath).isFile()) {
        return new Response(readFileSync(filePath) as unknown as BodyInit, {
          status: 200,
          headers: {
            "Content-Type": contentType,
            "Cache-Control": "public, max-age=31536000, immutable",
            "X-OpenPortal-Asset-Source": "disk",
          },
        });
      }
    } catch {
      // fall through to shim
    }
  }

  return new Response(ext === "js" ? RELOAD_SHIM_JS : EMPTY_CSS, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "X-OpenPortal-Asset-Source": "shim",
    },
  });
});
