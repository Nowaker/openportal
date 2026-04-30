import { defineHandler, readBody, getMethod } from "nitro/h3";
import { getSettings, setSetting } from "../lib/portal-state";

interface SettingsBody {
  namespace?: unknown;
  value?: unknown;
}

export default defineHandler(async (event) => {
  const method = getMethod(event);
  if (method === "GET") {
    return { settings: getSettings() };
  }
  const body = (await readBody(event)) as SettingsBody | null;
  const namespace = typeof body?.namespace === "string" ? body.namespace : "";
  if (!namespace) return { settings: getSettings() };
  return { settings: setSetting(namespace, body?.value ?? null) };
});
