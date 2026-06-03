import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
import { execSync } from "node:child_process";

const BUILD_ID = String(Date.now());
const COMMIT_SUBJECT_MAX_CHARS = 96;

function readGitValue(command: string, fallback: string): string {
  try {
    const raw = execSync(command, { encoding: "utf8" }).trim();
    return raw || fallback;
  } catch {
    return fallback;
  }
}

function capCommitSubject(subject: string): string {
  if (subject.length <= COMMIT_SUBJECT_MAX_CHARS) return subject;
  return `${subject.slice(0, COMMIT_SUBJECT_MAX_CHARS - 1).trimEnd()}…`;
}

const COMMIT_SHA = readGitValue("git rev-parse --short=12 HEAD", "unknown");
const COMMIT_SUBJECT = capCommitSubject(
  readGitValue("git log -1 --pretty=%s", "unknown commit"),
);

export default defineConfig({
  // "hidden" emits .map files but omits the //# sourceMappingURL comment, so DevTools must opt in.
  build: { sourcemap: "hidden" },
  define: {
    __OPENPORTAL_BUILD_ID__: JSON.stringify(BUILD_ID),
    __OPENPORTAL_COMMIT_SHA__: JSON.stringify(COMMIT_SHA),
    __OPENPORTAL_COMMIT_SUBJECT__: JSON.stringify(COMMIT_SUBJECT),
  },
  plugins: [
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
    }),
    react(),
    tailwindcss(),
    nitro({
      preset: "bun",
    }),
  ],
  resolve: {
    alias: {
      "@": "/src",
    },
  },
});
