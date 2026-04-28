import { defineHandler } from "nitro/h3";
import { homedir } from "os";
import { join } from "path";
import { readFileSync, existsSync } from "fs";

const CONFIG_PATH = join(homedir(), ".portal.json");

export default defineHandler(() => {
  const myPort = parseInt(process.env.PORT || "", 10);
  if (!myPort || Number.isNaN(myPort)) {
    return { instance: null, error: "PORT env not set" };
  }

  if (!existsSync(CONFIG_PATH)) {
    return { instance: null, error: "no config file" };
  }

  try {
    const config = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    const me = (config.instances || []).find(
      (i: { port: number | null }) => i.port === myPort,
    );
    if (!me) {
      return { instance: null, error: `no registry entry for PORT=${myPort}` };
    }
    return {
      instance: {
        id: me.id,
        name: me.name,
        directory: me.directory,
        port: me.opencodePort,
        hostname: me.hostname,
      },
    };
  } catch (e) {
    return {
      instance: null,
      error: e instanceof Error ? e.message : "config read failed",
    };
  }
});
