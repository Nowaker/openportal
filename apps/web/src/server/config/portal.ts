import { defineHandler } from "nitro/h3";
import { homedir } from "os";
import { readPortalConfig } from "../lib/portal-config";

export default defineHandler(() => {
  const config = readPortalConfig();
  return {
    directories: config.directories,
    baseDirs: config.baseDirs,
    home: homedir(),
  };
});
