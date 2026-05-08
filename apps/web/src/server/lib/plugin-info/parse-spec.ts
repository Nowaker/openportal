import type { PluginSource } from "./types";

export interface ParsedSpec {
  source: PluginSource;
  packageName?: string;
  requestedVersion?: string;
  filePath?: string;
}

export function parsePluginSpec(spec: string): ParsedSpec {
  const trimmed = spec.trim();
  if (!trimmed) {
    return { source: "local" };
  }

  if (trimmed.startsWith("file://")) {
    return { source: "local", filePath: trimmed.slice("file://".length) };
  }
  if (trimmed.startsWith("/") || trimmed.startsWith("./") || trimmed.startsWith("../")) {
    return { source: "local", filePath: trimmed };
  }

  // npm spec: optional leading `@scope/`, then name, then optional `@version`.
  // We split on the LAST `@` to separate name from version, but only if the
  // result still has a non-empty name (otherwise we'd misparse a bare scoped
  // package like `@scope/foo` as name=`@scope/foo` version=undefined, which
  // is correct).
  let packageName = trimmed;
  let requestedVersion: string | undefined;
  const lastAt = trimmed.lastIndexOf("@");
  // Skip the leading `@` of a scoped package - it's at index 0 and not a
  // version separator.
  if (lastAt > 0) {
    packageName = trimmed.slice(0, lastAt);
    requestedVersion = trimmed.slice(lastAt + 1);
  }

  return { source: "npm", packageName, requestedVersion };
}
