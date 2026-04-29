// Tiny pre-loader for the bundled Nitro web server. Installed by the CLI
// (Bun.spawn target) instead of the bundle itself so we get a process
// hook in BEFORE any handler imports run. Two responsibilities:
//   1. Catch unhandledRejection / uncaughtException and log+continue. Bun's
//      and Node's defaults terminate the process, which makes the web UI
//      die as soon as a transient opencode outage causes a single proxy
//      handler to throw asynchronously. We'd rather return 5xx for that
//      one request than kill the whole web server.
//   2. Resolve the actual bundle path from OPENPORTAL_WEB_BUNDLE and load
//      it. The CLI passes the absolute path so this wrapper stays
//      location-independent and can be vendored alongside the CLI binary
//      regardless of where the apps/web/.output symlink target lives.

process.on("unhandledRejection", (reason) => {
  console.error("[web-wrapper] unhandledRejection (suppressed):", reason);
});
process.on("uncaughtException", (reason) => {
  console.error("[web-wrapper] uncaughtException (suppressed):", reason);
});

const target = process.env.OPENPORTAL_WEB_BUNDLE;
if (!target) {
  console.error(
    "[web-wrapper] missing OPENPORTAL_WEB_BUNDLE env; refusing to start",
  );
  process.exit(1);
}
await import(target);
