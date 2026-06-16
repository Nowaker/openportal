import { getSettings, setSetting } from "./portal-state";

const NAMESPACE = "modelVisibility";

export type Visibility = "show" | "hide";

// Model identity is `${providerID}:${modelID}`. Visibility is scoped per
// server because each registered opencode instance can have its own
// providers configured, so the user may want different lists per server.
export interface ModelVisibilityConfig {
  byServer: Record<string, Record<string, Visibility>>;
}

const EMPTY: ModelVisibilityConfig = { byServer: {} };

function readConfig(): ModelVisibilityConfig {
  const raw = getSettings()[NAMESPACE];
  if (!raw || typeof raw !== "object") return { byServer: {} };
  const obj = raw as Partial<ModelVisibilityConfig>;
  const out: ModelVisibilityConfig = { byServer: {} };
  if (obj.byServer && typeof obj.byServer === "object") {
    for (const [serverId, models] of Object.entries(obj.byServer)) {
      if (!models || typeof models !== "object") continue;
      const cleaned: Record<string, Visibility> = {};
      for (const [key, vis] of Object.entries(
        models as Record<string, unknown>,
      )) {
        if (vis === "show" || vis === "hide") cleaned[key] = vis;
      }
      if (Object.keys(cleaned).length > 0) out.byServer[serverId] = cleaned;
    }
  }
  return out;
}

function writeConfig(config: ModelVisibilityConfig): ModelVisibilityConfig {
  setSetting(NAMESPACE, config);
  return config;
}

export function getModelVisibility(): ModelVisibilityConfig {
  return readConfig();
}

export function setVisibility(
  serverId: string,
  modelKey: string,
  visibility: Visibility,
): ModelVisibilityConfig {
  const config = readConfig();
  const perServer = { ...(config.byServer[serverId] ?? {}) };
  perServer[modelKey] = visibility;
  return writeConfig({
    byServer: { ...config.byServer, [serverId]: perServer },
  });
}

export function clearVisibility(
  serverId: string,
  modelKey: string,
): ModelVisibilityConfig {
  const config = readConfig();
  const perServer = { ...(config.byServer[serverId] ?? {}) };
  delete perServer[modelKey];
  const nextByServer = { ...config.byServer };
  if (Object.keys(perServer).length > 0) {
    nextByServer[serverId] = perServer;
  } else {
    delete nextByServer[serverId];
  }
  return writeConfig({ byServer: nextByServer });
}

export function clearServerVisibility(
  serverId: string,
): ModelVisibilityConfig {
  const config = readConfig();
  const next = { ...config.byServer };
  delete next[serverId];
  return writeConfig({ byServer: next });
}

export { EMPTY as EMPTY_MODEL_VISIBILITY };
