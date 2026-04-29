import { defineHandler } from "nitro/h3";
import { existsSync, readFileSync } from "fs";
import { homedir, hostname, type, release } from "os";
import { join } from "path";

const PORTAL_CONFIG_PATH = join(homedir(), ".portal.json");
const OPENPORTAL_CONFIG_PATH = join(homedir(), ".openportal.json");
const STATE_FILE_PATH = join(homedir(), ".openportal-state.json");

function readJsonFileSize(path: string): number | null {
  try {
    if (!existsSync(path)) return null;
    return readFileSync(path, "utf8").length;
  } catch {
    return null;
  }
}

export default defineHandler(() => {
  const proc = (typeof process !== "undefined" ? process : null) as
    | (NodeJS.Process & { uptime?: () => number })
    | null;
  return {
    process: {
      pid: proc?.pid ?? null,
      uptimeSeconds: proc?.uptime ? Math.floor(proc.uptime()) : null,
      nodeVersion: proc?.versions?.node ?? null,
      bunVersion: proc?.versions?.bun ?? null,
      platform: proc?.platform ?? null,
    },
    os: {
      hostname: hostname(),
      type: type(),
      release: release(),
    },
    stateFiles: {
      portalConfig: {
        path: PORTAL_CONFIG_PATH,
        exists: existsSync(PORTAL_CONFIG_PATH),
        bytes: readJsonFileSize(PORTAL_CONFIG_PATH),
      },
      openportalConfig: {
        path: OPENPORTAL_CONFIG_PATH,
        exists: existsSync(OPENPORTAL_CONFIG_PATH),
        bytes: readJsonFileSize(OPENPORTAL_CONFIG_PATH),
      },
      sessionState: {
        path: STATE_FILE_PATH,
        exists: existsSync(STATE_FILE_PATH),
        bytes: readJsonFileSize(STATE_FILE_PATH),
      },
    },
  };
});
