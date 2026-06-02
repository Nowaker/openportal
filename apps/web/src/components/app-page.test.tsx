import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  AppPage,
  AppPageBody,
  AppPageContainer,
  AppPageHeader,
} from "./app-page";

describe("AppPage layout primitives", () => {
  it("keeps app pages inside the route outlet instead of escaping with negative margins", () => {
    const html = renderToStaticMarkup(
      <AppPage>
        <AppPageHeader />
        <AppPageBody />
      </AppPage>,
    );

    expect(html).toContain("flex min-h-0 flex-1 flex-col overflow-hidden");
    expect(html).toContain("shrink-0 border-b border-border");
    expect(html).toContain("min-h-0 flex-1 overflow-auto overscroll-contain");
  });

  it("supports bounded document-style pages without duplicating scroll wrappers", () => {
    const html = renderToStaticMarkup(
      <AppPageContainer maxWidth="3xl">Docs</AppPageContainer>,
    );

    expect(html).toContain("min-h-0 flex-1 overflow-auto overscroll-contain");
    expect(html).toContain("mx-auto w-full max-w-3xl px-4 py-6");
  });
});
