import { defineHandler } from "nitro/h3";
import {
  installCompanionPlugin,
  isCompanionInstalled,
} from "../lib/opencode-config";

const PLUGIN_PATH = "/home/nowaker/projekty/webapps/portal/packages/openportal-companion-plugin";

export default defineHandler(() => {
  const before = isCompanionInstalled();
  const result = installCompanionPlugin(PLUGIN_PATH);
  return {
    alreadyInstalled: before,
    changed: result.changed,
    configPath: result.configPath,
    pluginPath: PLUGIN_PATH,
    note: result.changed
      ? `Added plugin entry to ${result.configPath}. Restart your opencode-serve service for the plugin to load.`
      : `Plugin already present in ${result.configPath}.`,
  };
});
