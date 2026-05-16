import { defineHandler } from "nitro/h3";
import {
  readPortalRegistry,
  isInstanceAlive,
} from "./lib/portal-registry";

export default defineHandler(async () => {
  const config = readPortalRegistry();

  const instancePromises = config.instances.map(async (instance) => {
    const alive = await isInstanceAlive(instance);
    if (!alive) return null;
    return {
      id: instance.id,
      name: instance.name,
      directory: instance.directory,
      port: instance.opencodePort,
      webPort: instance.port,
      hostname: instance.hostname,
      opencodePid: instance.opencodePid,
      webPid: instance.webPid,
      startedAt: instance.startedAt,
      instanceType: instance.instanceType,
      containerId: instance.containerId,
      state: "running" as const,
    };
  });

  const results = await Promise.all(instancePromises);
  const instances = results.filter((instance) => instance !== null);
  const staleCount = config.instances.length - instances.length;

  return {
    total: instances.length,
    instances,
    staleCount,
  };
});
