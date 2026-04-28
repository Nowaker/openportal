import { defineHandler } from "nitro/h3";
import { readPortalConfig } from "../lib/portal-config";

export default defineHandler(() => {
  const config = readPortalConfig();
  return { directories: config.directories };
});
