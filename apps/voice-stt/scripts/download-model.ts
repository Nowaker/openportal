#!/usr/bin/env bun
import { mkdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");
const MODELS_DIR = join(ROOT, "models");

interface ModelSpec {
  id: string;
  filename: string;
  url: string;
  bytes: number;
}

const MODELS: Record<string, ModelSpec> = {
  "tiny.en": {
    id: "tiny.en",
    filename: "ggml-tiny.en.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin?download=true",
    bytes: 77_700_000,
  },
  "base.en": {
    id: "base.en",
    filename: "ggml-base.en.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin?download=true",
    bytes: 147_900_000,
  },
  "small.en": {
    id: "small.en",
    filename: "ggml-small.en.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin?download=true",
    bytes: 487_700_000,
  },
};

async function main() {
  const requested = process.argv[2] ?? "base.en";
  const spec = MODELS[requested];
  if (!spec) {
    console.error(
      `Unknown model: ${requested}. Available: ${Object.keys(MODELS).join(", ")}`,
    );
    process.exit(1);
  }
  await mkdir(MODELS_DIR, { recursive: true });
  const target = join(MODELS_DIR, spec.filename);
  if (existsSync(target)) {
    const s = await stat(target);
    if (s.size > spec.bytes / 2) {
      console.log(`Already present: ${target} (${s.size} bytes)`);
      return;
    }
    console.log(`Re-downloading partial file: ${target}`);
  }
  console.log(`Downloading ${spec.id} (~${Math.round(spec.bytes / 1_000_000)}MB) ...`);
  const res = await fetch(spec.url);
  if (!res.ok || !res.body) {
    console.error(`HTTP ${res.status} when fetching ${spec.url}`);
    process.exit(1);
  }
  const buf = await res.arrayBuffer();
  await Bun.write(target, buf);
  console.log(`Wrote ${target} (${buf.byteLength} bytes)`);
  console.log("");
  console.log("Next steps:");
  console.log("  1. git lfs track 'apps/voice-stt/models/*.bin'  # already configured globally");
  console.log("  2. git add apps/voice-stt/models/" + spec.filename + "  # tracked via LFS");
  console.log("  3. git commit -m 'voice-stt: vendor " + spec.id + " whisper model'");
  console.log("");
  console.log("To run the sidecar with this model:");
  console.log(`  VOICE_STT_MODEL=${spec.id} VOICE_STT_MODEL_PATH=${target} bun run start`);
}

await main();
