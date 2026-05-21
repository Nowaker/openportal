import { defineHandler, getQuery, HTTPError } from "nitro/h3";
import {
  installCompanionPlugin,
  isCompanionInstalled,
} from "../lib/opencode-config";
import {
  detectOpencodeService,
  restartUserService,
} from "../lib/opencode-service";
import { getServerByPort } from "../lib/server-registry";

const PLUGIN_PATH = "/home/nowaker/projekty/webapps/portal/packages/openportal-companion-plugin";

export default defineHandler((event) => {
  const q = getQuery(event);
  const portRaw = typeof q.port === "string" ? q.port : null;
  const port = portRaw && /^\d+$/.test(portRaw) ? Number(portRaw) : null;
  if (!port) {
    throw new HTTPError("port query param required", { status: 400 });
  }
  const server = getServerByPort(port);
  const host = server?.host ?? "0.0.0.0";

  const before = isCompanionInstalled();
  const install = installCompanionPlugin(PLUGIN_PATH);

  const svc = detectOpencodeService(host, port);

  if (svc.scope === "user" && svc.unitName) {
    const restart = restartUserService(svc.unitName);
    return {
      alreadyInstalled: before,
      changed: install.changed,
      configPath: install.configPath,
      pluginPath: PLUGIN_PATH,
      service: svc,
      restart,
      note: restart.ok
        ? `Plugin ${install.changed ? "added" : "already present"}; user service ${svc.unitName} restarted.`
        : `Plugin ${install.changed ? "added" : "already present"}; restart of ${svc.unitName} FAILED. Restart manually: systemctl --user restart ${svc.unitName}`,
    };
  }

  if (svc.scope === "system" && svc.unitName) {
    return {
      alreadyInstalled: before,
      changed: install.changed,
      configPath: install.configPath,
      pluginPath: PLUGIN_PATH,
      service: svc,
      restart: { ok: false, output: "system service - sudo required" },
      note: `Plugin ${install.changed ? "added" : "already present"}; ${svc.unitName} is a SYSTEM service. Restart it manually: sudo systemctl restart ${svc.unitName}`,
    };
  }

  return {
    alreadyInstalled: before,
    changed: install.changed,
    configPath: install.configPath,
    pluginPath: PLUGIN_PATH,
    service: svc,
    restart: { ok: false, output: "unit not detected" },
    note: `Plugin ${install.changed ? "added" : "already present"}; OpenCode is not running under a recognised systemd unit. Restart it however you started it (terminal, pid ${svc.opencodePid ?? "?"}).`,
  };
});
