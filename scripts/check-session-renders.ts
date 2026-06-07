#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SESSION_ID = process.env.OPENPORTAL_RENDER_CHECK_SESSION_ID ?? "ses_openportal_render_check";
const BASE_URL = (process.env.OPENPORTAL_RENDER_CHECK_URL ?? process.argv[2] ?? "http://100.105.229.19:5000/").replace(/\/$/, "");
const CHROME = process.env.CHROMIUM_BIN ?? process.env.CHROME_BIN ?? "/usr/bin/chromium";
const TIMEOUT_MS = Number(process.env.OPENPORTAL_RENDER_CHECK_TIMEOUT_MS ?? "45000");

let targetUrl = `${BASE_URL}/session/${encodeURIComponent(SESSION_ID)}`;
const userDataDir = mkdtempSync(join(tmpdir(), "openportal-render-check-"));
const failures: string[] = [];
const consoleMessages: string[] = [];
const badResponses: string[] = [];

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return (await res.json()) as T;
}

async function waitForWs(port: number): Promise<string> {
  const deadline = Date.now() + 10_000;
  const url = `http://127.0.0.1:${port}/json/version`;
  while (Date.now() < deadline) {
    try {
      const json = await fetchJson<{ webSocketDebuggerUrl: string }>(url);
      if (json.webSocketDebuggerUrl) return json.webSocketDebuggerUrl;
    } catch {}
    await wait(100);
  }
  throw new Error("Chromium remote debugging endpoint did not start");
}

function send(ws: WebSocket, method: string, params: Record<string, unknown> = {}, sessionId?: string) {
  const id = nextId++;
  ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
  return new Promise<any>((resolve, reject) => {
    pending.set(id, { resolve, reject });
  });
}

let nextId = 1;
const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();

const debugPort = 9300 + Math.floor(Math.random() * 1000);
const chrome = spawn(CHROME, [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-dev-shm-usage",
  "--ignore-certificate-errors",
  `--user-data-dir=${userDataDir}`,
  `--remote-debugging-port=${debugPort}`,
  "about:blank",
], { stdio: ["ignore", "pipe", "pipe"] });

let chromeStderr = "";
chrome.stderr.on("data", (chunk) => {
  chromeStderr += String(chunk);
});

try {
  const self = await fetchJson<{ instance?: { id?: string } | null }>(`${BASE_URL}/api/instance/self`);
  const serverId = process.env.OPENPORTAL_RENDER_CHECK_SERVER_ID ?? self.instance?.id;
  if (serverId) {
    targetUrl = `${targetUrl}?server=${encodeURIComponent(serverId)}`;
  }

  const browserWs = await waitForWs(debugPort);
  const ws = new WebSocket(browserWs);
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", () => reject(new Error("WebSocket open failed")), { once: true });
  });
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(String(event.data));
    if (typeof msg.id === "number" && pending.has(msg.id)) {
      const entry = pending.get(msg.id)!;
      pending.delete(msg.id);
      if (msg.error) entry.reject(new Error(JSON.stringify(msg.error)));
      else entry.resolve(msg.result);
      return;
    }
    if (msg.method === "Runtime.consoleAPICalled") {
      const level = msg.params?.type;
      const text = (msg.params?.args ?? []).map((arg: any) => arg.value ?? arg.description ?? "").join(" ");
      consoleMessages.push(`${level}: ${text}`);
      if (level === "error") failures.push(`console.error: ${text}`);
    }
    if (msg.method === "Runtime.exceptionThrown") {
      const text = msg.params?.exceptionDetails?.text ?? "Runtime exception";
      failures.push(`exception: ${text}`);
    }
    if (msg.method === "Network.responseReceived") {
      const status = Number(msg.params?.response?.status ?? 0);
      const url = String(msg.params?.response?.url ?? "");
      if (status >= 500) {
        badResponses.push(`${status} ${url}`);
        failures.push(`HTTP ${status}: ${url}`);
      }
    }
    if (msg.method === "Log.entryAdded") {
      const level = msg.params?.entry?.level;
      const text = msg.params?.entry?.text;
      if (level === "error") failures.push(`log error: ${text}`);
    }
  });

  const { targetId } = await send(ws, "Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send(ws, "Target.attachToTarget", { targetId, flatten: true });
  const call = (method: string, params: Record<string, unknown> = {}) => send(ws, method, params, sessionId);
  await call("Runtime.enable");
  await call("Network.enable");
  await call("Log.enable");
  await call("Page.enable");
  await call("Page.navigate", { url: targetUrl });

  const deadline = Date.now() + TIMEOUT_MS;
  let observed: any = null;
  while (Date.now() < deadline) {
    const result = await call("Runtime.evaluate", {
      expression: `(() => {
        const messages = [...document.querySelectorAll('[data-message-id]')].map((el) => el.getAttribute('data-message-id'));
        const toolcalls = [...document.querySelectorAll('[data-test^="portal-toolcall-"]')].map((el) => el.getAttribute('data-test'));
        const empty = Boolean(document.querySelector('[data-test="portal-empty-chat-state"]'));
        const rootText = document.body.innerText || '';
        const errorText = /Application error|Unhandled|ReferenceError|TypeError|not defined/i.test(rootText);
        return { href: location.href, title: document.title, messages, toolcalls, empty, errorText, text: rootText.slice(0, 2000) };
      })()`,
      returnByValue: true,
    });
    observed = result.result?.value;
    if (observed?.messages?.includes("msg_render_007_queued") && observed?.toolcalls?.length >= 3) break;
    await wait(500);
  }

  if (!observed) failures.push("No DOM observation returned");
  if (observed?.empty) failures.push("Session rendered empty state");
  if (observed?.errorText) failures.push("Page text matched a runtime error marker");
  for (const expected of ["msg_render_001_user", "msg_render_002_assistant", "msg_render_004_assistant", "msg_render_007_queued"]) {
    if (!observed?.messages?.includes(expected)) failures.push(`Missing rendered message ${expected}`);
  }
  for (const expected of ["portal-toolcall-bash", "portal-toolcall-question", "portal-toolcall-task"]) {
    if (!observed?.toolcalls?.includes(expected)) failures.push(`Missing rendered tool call ${expected}`);
  }

  await send(ws, "Browser.close").catch(() => {});
  if (failures.length > 0) {
    console.error("render check FAILED");
    console.error(`url: ${targetUrl}`);
    console.error(JSON.stringify({ failures, badResponses, consoleMessages, observed }, null, 2));
    process.exit(1);
  }
  console.log("render check ok");
  console.log(`url: ${targetUrl}`);
  console.log(`messages: ${observed.messages.length}`);
  console.log(`toolcalls: ${observed.toolcalls.length}`);
} finally {
  chrome.kill("SIGTERM");
  await wait(200);
  if (!chrome.killed) chrome.kill("SIGKILL");
  rmSync(userDataDir, { recursive: true, force: true });
  if (chromeStderr.includes("Missing X server")) {
    console.error(chromeStderr);
  }
}
