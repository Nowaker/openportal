import { defineHandler } from "nitro/h3";
import {
  readPortalRegistry,
  writePortalRegistry,
  isInstanceAlive,
} from "../lib/portal-registry";

export default defineHandler(async () => {
  const config = readPortalRegistry();
  const before = config.instances.length;
  const liveFlags = await Promise.all(
    config.instances.map((instance) => isInstanceAlive(instance)),
  );
  const live = config.instances.filter((_, i) => liveFlags[i]);
  const removed = before - live.length;
  if (removed > 0) {
    writePortalRegistry({ ...config, instances: live });
  }
  return { removed, remaining: live.length };
});
