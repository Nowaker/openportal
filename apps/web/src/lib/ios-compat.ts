export function isIOS(browser: Pick<Navigator, "userAgent" | "maxTouchPoints">): boolean {
  return /iPad|iPhone|iPod/.test(browser.userAgent) ||
    (/Macintosh/.test(browser.userAgent) && browser.maxTouchPoints > 1);
}

export function isIOSZoomed(
  browser: Pick<Navigator, "userAgent" | "maxTouchPoints">,
  viewport: Pick<VisualViewport, "scale"> | null,
): boolean {
  return isIOS(browser) && viewport !== null && Math.abs(viewport.scale - 1) > 0.01;
}

export function installIOSCompatibility(): () => void {
  if (!isIOS(navigator)) return () => {};

  const root = document.documentElement;
  root.dataset.ios = "true";
  const viewportMeta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  const originalViewport = viewportMeta?.content;
  if (viewportMeta) viewportMeta.content = `${originalViewport},viewport-fit=cover`;

  const manifest = document.createElement("link");
  manifest.rel = "manifest";
  manifest.href = "/ios.webmanifest";
  const icon = document.createElement("link");
  icon.rel = "apple-touch-icon";
  icon.sizes = "180x180";
  icon.href = "/ios-touch-icon.png";
  const capable = document.createElement("meta");
  capable.name = "apple-mobile-web-app-capable";
  capable.content = "yes";
  document.head.append(manifest, icon, capable);

  const viewport = window.visualViewport;
  const update = () => {
    // Keyboard/toolbars change height at scale 1. Pinch zoom must instead
    // magnify and pan the existing layout, not reflow it under the fingers.
    if (isIOSZoomed(navigator, viewport)) return;
    root.style.setProperty("--ios-viewport-height", `${viewport?.height ?? window.innerHeight}px`);
    root.style.setProperty("--ios-viewport-top", `${viewport?.offsetTop ?? 0}px`);
  };
  update();
  viewport?.addEventListener("resize", update);
  viewport?.addEventListener("scroll", update);
  window.addEventListener("resize", update);
  window.addEventListener("pageshow", update);

  return () => {
    viewport?.removeEventListener("resize", update);
    viewport?.removeEventListener("scroll", update);
    window.removeEventListener("resize", update);
    window.removeEventListener("pageshow", update);
    manifest.remove();
    icon.remove();
    capable.remove();
    delete root.dataset.ios;
    root.style.removeProperty("--ios-viewport-height");
    root.style.removeProperty("--ios-viewport-top");
    if (viewportMeta && originalViewport !== undefined) viewportMeta.content = originalViewport;
  };
}
