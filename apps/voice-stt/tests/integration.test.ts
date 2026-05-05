import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildServer } from "../src/index";

const MODEL_PATH =
  process.env.VOICE_STT_MODEL_PATH ||
  resolve(import.meta.dir, "..", "models", "ggml-base.en.bin");
const AUDIO_FIXTURE = resolve(
  import.meta.dir,
  "fixtures",
  "audio",
  "hello-world.wav",
);

const SHOULD_RUN = existsSync(MODEL_PATH) && existsSync(AUDIO_FIXTURE);

if (!SHOULD_RUN) {
  console.warn(
    `[integration] SKIPPING - model=${MODEL_PATH} exists=${existsSync(MODEL_PATH)} audio=${AUDIO_FIXTURE} exists=${existsSync(AUDIO_FIXTURE)}`,
  );
  console.warn(
    "[integration] Run `bun run download-model` and add a WAV fixture under tests/fixtures/audio/hello-world.wav to enable.",
  );
}

const describeIfReady = SHOULD_RUN ? describe : describe.skip;

let server: ReturnType<typeof buildServer>;
let baseUrl: string;

beforeAll(() => {
  if (!SHOULD_RUN) return;
  server = buildServer({
    host: "127.0.0.1",
    port: 0,
    model: "base.en",
    modelPath: MODEL_PATH,
  });
  baseUrl = `http://${server.hostname}:${server.port}`;
});

afterAll(() => {
  if (server) server.stop(true);
});

describeIfReady("voice-stt /transcribe end-to-end (model + audio required)", () => {
  it("multipart upload returns transcription", async () => {
    const buf = readFileSync(AUDIO_FIXTURE);
    const form = new FormData();
    form.append(
      "audio",
      new Blob([buf as unknown as ArrayBuffer], { type: "audio/wav" }),
      "hello-world.wav",
    );
    const res = await fetch(`${baseUrl}/transcribe`, {
      method: "POST",
      body: form,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.text).toBeTruthy();
    expect(typeof body.text).toBe("string");
    expect(body.text.toLowerCase()).toMatch(/(hello|world)/);
  }, 60_000);

  it("raw audio body returns transcription", async () => {
    const buf = readFileSync(AUDIO_FIXTURE);
    const res = await fetch(`${baseUrl}/transcribe`, {
      method: "POST",
      headers: { "Content-Type": "audio/wav" },
      body: new Uint8Array(buf),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.text).toBeTruthy();
    expect(body.text.toLowerCase()).toMatch(/(hello|world)/);
  }, 60_000);
});
