import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

import { CompactBanner } from "./compact-banner";

describe("CompactBanner", () => {
  it("uses the shared alert banner marker for stack border styling", () => {
    const html = renderToStaticMarkup(
      <CompactBanner intent="warning" icon="!" message="Warning" />,
    );

    expect(html).toContain("openportal-alert-banner");
    expect(html).toContain("border-b");
  });

  it("keeps first-banner top-border styling centralized in CSS", () => {
    const css = readFileSync(
      resolve(import.meta.dir, "../../main.css"),
      "utf8",
    );

    expect(css).toContain(".openportal-alert-banner:first-child");
    expect(css).toContain(":not(.openportal-alert-banner) + .openportal-alert-banner");
    expect(css).toContain("border-top-style: solid");
    expect(css).toContain("border-top-width: 1px");
  });
});
