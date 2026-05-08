import { defineHandler, getMethod, getQuery, readBody } from "nitro/h3";
import {
  getPluginInfoCached,
  invalidatePluginInfo,
  refreshPluginInfo,
} from "../../lib/plugin-info-cache";
import { parsePort } from "../../lib/validation";

export default defineHandler(async (event) => {
  const port = parsePort(event);
  const method = getMethod(event);

  if (method === "POST") {
    const body = (await readBody(event)) as { spec?: unknown } | null;
    const spec = typeof body?.spec === "string" ? body.spec : "";
    if (!spec) return { error: "Missing 'spec' in body" };
    invalidatePluginInfo(spec);
    const info = await refreshPluginInfo(port, spec);
    return { info, refreshing: false };
  }

  const query = getQuery(event);
  const spec = typeof query.spec === "string" ? query.spec : "";
  if (!spec) {
    return { error: "Missing 'spec' query parameter" };
  }
  const { info, refreshing } = await getPluginInfoCached(port, spec);
  return { info, refreshing };
});
