export function withServerSearch<T extends object>(search: T, server: string) {
  return { ...search, server };
}

interface NewSessionSearchSource {
  readonly server?: string;
  readonly directory?: string;
}

interface NewSessionSearchTarget {
  readonly directory?: string;
  readonly autoPrompt?: string;
}

interface NewSessionSearch extends NewSessionSearchSource {
  readonly autoPrompt?: string;
}

export function sanitizeNewSessionSearch<T extends object>(
  search: T & NewSessionSearchSource,
  target: NewSessionSearchTarget = {},
): NewSessionSearch {
  const server = search.server;
  const directory = target.directory ?? search.directory;
  const autoPrompt = target.autoPrompt;
  return {
    ...(server ? { server } : {}),
    ...(directory ? { directory } : {}),
    ...(autoPrompt ? { autoPrompt } : {}),
  };
}

export function sanitizeNewSessionHref(href: string): string {
  const url = new URL(href, "http://openportal.local");
  if (url.pathname !== "/session/new") return href;
  const safeSearch = sanitizeNewSessionSearch({
    server: url.searchParams.get("server") ?? undefined,
    directory: url.searchParams.get("directory") ?? undefined,
  });
  const allowed = new URLSearchParams();
  if (safeSearch.server) allowed.set("server", safeSearch.server);
  if (safeSearch.directory) allowed.set("directory", safeSearch.directory);
  const search = allowed.toString();
  return `${url.pathname}${search ? `?${search}` : ""}${url.hash}`;
}
