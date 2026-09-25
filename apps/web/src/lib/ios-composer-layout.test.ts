import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const chromium = process.env.CHROMIUM_BIN ?? Bun.which("chromium");

test.skipIf(!chromium)("iOS composer fits below stacked banners while Android keeps its layout", () => {
  if (!chromium) return;
  mkdirSync(resolve(import.meta.dir, "../../../../tmp"), { recursive: true });
  const profile = mkdtempSync(resolve(import.meta.dir, "../../../../tmp/ios-layout-"));
  const compatibilityCss = readFileSync(resolve(import.meta.dir, "../ios-compat.css"), "utf8");
  // Given the full route's 420px viewport, 159px banners and 32px content
  // padding floor, when the long composer requests 252px, then only iOS shrinks.
  const html = `<!doctype html><html data-ios="true"><head><style>
    * { box-sizing: border-box; } body { margin: 0; }
    [data-sidebar-root] { height:420px; display:flex; flex-direction:column; overflow:hidden; }
    header { flex:none; height:159px; }
    main { flex:1; min-height:0; display:flex; flex-direction:column; }
    article { flex:1; min-height:0; padding:16px; overflow:auto; }
    [data-composer-root] { flex-shrink:0; position:relative; display:flex; flex-direction:column;
      overflow:hidden; height:252px; max-height:252px; }
    button { position:absolute; bottom:4px; right:4px; width:48px; height:48px; }
    ${compatibilityCss}
    :root { --ios-viewport-height:420px; --ios-viewport-top:32px; }
  </style></head><body><div data-sidebar-root><header></header><main>
    <article></article><div data-composer-root><button>Send</button></div>
  </main></div><output></output><script>
    const shell = document.querySelector('[data-sidebar-root]');
    const composer = document.querySelector('[data-composer-root]');
    const send = document.querySelector('button');
    const ios = send.getBoundingClientRect().bottom <= shell.getBoundingClientRect().bottom;
    document.documentElement.removeAttribute('data-ios');
    const android = composer.getBoundingClientRect().height === 252;
    document.querySelector('output').textContent = ios && android ? 'layout-pass' : 'layout-fail';
  </script></body></html>`;
  try {
    const result = spawnSync(chromium, [
      "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
      `--user-data-dir=${profile}`, "--dump-dom", `data:text/html,${encodeURIComponent(html)}`,
    ], { encoding: "utf8", timeout: 20_000, env: { ...process.env, TMPDIR: profile } });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("<output>layout-pass</output>");
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
}, 25_000);
