import { defineHandler, setResponseStatus } from "nitro/h3";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const PLUGIN_PATH =
  "/home/nowaker/projekty/nowaker/opencode-tools/opencode-stuck-detector";
const CONFIG_PATH = join(homedir(), ".config/opencode/opencode.json");

const RESTART_CMD =
  "systemctl --user restart opencode-serve-tailscale opencode-serve-lan";

export default defineHandler(async (event) => {
  try {
    let raw: string;
    try {
      raw = await readFile(CONFIG_PATH, "utf-8");
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "ENOENT") {
        setResponseStatus(event, 404);
        return {
          ok: false,
          error: `opencode.json not found at ${CONFIG_PATH}`,
        };
      }
      throw err;
    }
    let config: { plugin?: unknown };
    try {
      config = JSON.parse(raw) as { plugin?: unknown };
    } catch (err) {
      setResponseStatus(event, 422);
      return {
        ok: false,
        error: `opencode.json is not valid JSON: ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }
    if (!config || typeof config !== "object") {
      setResponseStatus(event, 422);
      return { ok: false, error: "opencode.json top-level is not an object" };
    }
    const pluginRaw = config.plugin;
    const plugin: string[] = Array.isArray(pluginRaw)
      ? pluginRaw.filter((p): p is string => typeof p === "string")
      : [];
    const alreadyInstalled = plugin.includes(PLUGIN_PATH);
    if (!alreadyInstalled) {
      plugin.push(PLUGIN_PATH);
      (config as { plugin: string[] }).plugin = plugin;
      await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
    }
    return {
      ok: true,
      alreadyInstalled,
      configPath: CONFIG_PATH,
      pluginPath: PLUGIN_PATH,
      restartCommand: RESTART_CMD,
      message: alreadyInstalled
        ? "Plugin path is already in opencode.json. Run the restart command below to reload."
        : "Plugin path added to opencode.json. Run the restart command below to load it.",
    };
  } catch (err) {
    setResponseStatus(event, 500);
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
});
