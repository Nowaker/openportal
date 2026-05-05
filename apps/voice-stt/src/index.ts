import { mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { nodewhisper } from "nodejs-whisper";

const DEFAULT_PORT = 4150;
const DEFAULT_MODEL = "base.en";
const DEFAULT_HOST = "127.0.0.1";

interface Config {
  port: number;
  host: string;
  model: string;
  modelPath: string | null;
}

function readConfig(): Config {
  const port = Number(process.env.VOICE_STT_PORT) || DEFAULT_PORT;
  const host = process.env.VOICE_STT_HOST || DEFAULT_HOST;
  const model = process.env.VOICE_STT_MODEL || DEFAULT_MODEL;
  const modelPath = process.env.VOICE_STT_MODEL_PATH || null;
  return { port, host, model, modelPath };
}

async function transcribeBuffer(
  audio: ArrayBuffer,
  filename: string,
  config: Config,
): Promise<string> {
  const tmp = join(tmpdir(), `voice-stt-${randomUUID()}`);
  await mkdir(tmp, { recursive: true });
  const inPath = join(tmp, filename);
  await writeFile(inPath, new Uint8Array(audio));
  try {
    const result = await nodewhisper(inPath, {
      modelName: config.model,
      autoDownloadModelName: config.modelPath ? undefined : config.model,
      removeWavFileAfterTranscription: true,
      withCuda: false,
      logger: console,
      whisperOptions: {
        outputInText: true,
        outputInVtt: false,
        outputInSrt: false,
        outputInCsv: false,
        translateToEnglish: false,
        wordTimestamps: false,
        timestamps_length: 0,
        splitOnWord: false,
      },
    });
    if (typeof result === "string") return result.trim();
    if (result && typeof result === "object" && "transcription" in result) {
      const t = (result as { transcription?: string }).transcription;
      return (t ?? "").trim();
    }
    return "";
  } finally {
    try {
      await rm(tmp, { recursive: true, force: true });
    } catch {}
  }
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

function corsPreflight(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}

async function handleTranscribe(req: Request, config: Config): Promise<Response> {
  const contentType = req.headers.get("content-type") ?? "";
  let audio: ArrayBuffer;
  let filename = "audio.webm";

  if (contentType.startsWith("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("audio");
    if (!(file instanceof File)) {
      return jsonResponse(
        { error: "form field 'audio' (file) is required" },
        400,
      );
    }
    audio = await file.arrayBuffer();
    filename = file.name || filename;
  } else {
    audio = await req.arrayBuffer();
    const ct = contentType.split(";")[0]?.trim() ?? "";
    if (ct === "audio/webm" || ct === "audio/ogg") filename = `audio.webm`;
    else if (ct === "audio/wav" || ct === "audio/x-wav") filename = `audio.wav`;
    else if (ct === "audio/mpeg" || ct === "audio/mp3") filename = `audio.mp3`;
    else if (ct === "audio/mp4" || ct === "audio/m4a") filename = `audio.m4a`;
  }

  if (audio.byteLength === 0) {
    return jsonResponse({ error: "empty audio body" }, 400);
  }

  try {
    const text = await transcribeBuffer(audio, filename, config);
    return jsonResponse({ text });
  } catch (err) {
    return jsonResponse(
      { error: err instanceof Error ? err.message : "transcription failed" },
      500,
    );
  }
}

export function buildServer(config: Config) {
  return Bun.serve({
    hostname: config.host,
    port: config.port,
    development: false,
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method === "OPTIONS") return corsPreflight();
      if (url.pathname === "/health" && req.method === "GET") {
        return jsonResponse({
          ok: true,
          model: config.model,
          modelPath: config.modelPath,
        });
      }
      if (url.pathname === "/transcribe" && req.method === "POST") {
        return handleTranscribe(req, config);
      }
      return jsonResponse({ error: "not found" }, 404);
    },
  });
}

if (import.meta.main) {
  const config = readConfig();
  if (config.modelPath) {
    const abs = resolve(config.modelPath);
    if (!existsSync(abs)) {
      console.error(
        `[voice-stt] VOICE_STT_MODEL_PATH=${abs} does not exist. Run \`bun run download-model\` or set the path correctly.`,
      );
      process.exit(1);
    }
  }
  const server = buildServer(config);
  console.log(
    `[voice-stt] listening on http://${server.hostname}:${server.port} (model=${config.model})`,
  );
}
