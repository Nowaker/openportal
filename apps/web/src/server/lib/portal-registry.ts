import { homedir } from "os";
import { join } from "path";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { isContainerRunning } from "./docker";

export const PORTAL_CONFIG_PATH = join(homedir(), ".portal.json");

export type InstanceType = "process" | "docker";

export interface PortalInstance {
  id: string;
  name: string;
  directory: string;
  port: number | null;
  opencodePort: number;
  hostname: string;
  opencodePid: number | null;
  webPid: number | null;
  startedAt: string;
  instanceType: InstanceType;
  containerId: string | null;
}

export interface PortalConfig {
  instances: PortalInstance[];
}

export function readPortalRegistry(): PortalConfig {
  try {
    if (!existsSync(PORTAL_CONFIG_PATH)) return { instances: [] };
    const content = readFileSync(PORTAL_CONFIG_PATH, "utf-8");
    const config = JSON.parse(content) as PortalConfig;
    config.instances = (config.instances ?? []).map((instance) => ({
      ...instance,
      instanceType: instance.instanceType || "process",
      containerId: instance.containerId || null,
      opencodePid: instance.opencodePid ?? null,
      webPid: instance.webPid ?? null,
    }));
    return config;
  } catch (error) {
    console.warn(
      `[portal-registry] failed to read ${PORTAL_CONFIG_PATH}:`,
      error instanceof Error ? error.message : error,
    );
    return { instances: [] };
  }
}

export function writePortalRegistry(config: PortalConfig): void {
  writeFileSync(
    PORTAL_CONFIG_PATH,
    JSON.stringify(config, null, 2),
    "utf-8",
  );
}

function isProcessRunning(pid: number | null): boolean {
  if (pid === null) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function isInstanceAlive(
  instance: PortalInstance,
): Promise<boolean> {
  let opencodeRunning = false;
  if (instance.instanceType === "docker") {
    opencodeRunning = await isContainerRunning(instance.containerId);
  } else {
    opencodeRunning = isProcessRunning(instance.opencodePid);
  }
  const webRunning = isProcessRunning(instance.webPid);
  return opencodeRunning || webRunning;
}
