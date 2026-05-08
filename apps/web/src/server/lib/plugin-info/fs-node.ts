import { stat, readFile, readdir } from "node:fs/promises";
import { resolve as pathResolve } from "node:path";
import type { PluginFs } from "./types";

export const nodePluginFs: PluginFs = {
  async stat(path) {
    try {
      const s = await stat(path);
      return { isDirectory: s.isDirectory() };
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return null;
      throw err;
    }
  },
  async exists(path) {
    try {
      await stat(path);
      return true;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return false;
      throw err;
    }
  },
  async readFile(path) {
    try {
      return await readFile(path, "utf-8");
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return null;
      throw err;
    }
  },
  async readJson<T>(path: string) {
    try {
      const raw = await readFile(path, "utf-8");
      return JSON.parse(raw) as T;
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") return null;
      if (err instanceof SyntaxError) return null;
      throw err;
    }
  },
  async readdir(path) {
    try {
      return await readdir(path);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return [];
      throw err;
    }
  },
  resolve(...parts) {
    return pathResolve(...parts);
  },
};
