# @openportal/voice-stt

Self-hosted Whisper-based STT sidecar for openportal voice mode. Exposes
`POST /transcribe` over HTTP on the tailnet/local network. The frontend
records audio via `MediaRecorder` and uploads chunks here; the sidecar
runs whisper.cpp under the hood and returns the transcript as JSON.

## Why a separate package?

Voice mode is opt-in; most users won't enable it. Running whisper inside
the openportal web bundle would balloon cold-start memory and force every
deployment to ship a 150MB+ model file. Running it as a sidecar keeps the
web bundle lean and lets users co-locate the STT process on whatever box
has free CPU/GPU. The frontend only talks to the sidecar over HTTP —
swap it out for any Whisper-compatible service that exposes the same
`/transcribe` shape.

## Prerequisites

- Bun ≥ 1.1 (for runtime)
- ffmpeg (`apt install ffmpeg`) — `nodejs-whisper` shells out to it for
  format conversion when the uploaded audio isn't already 16 kHz mono WAV.
- ~150 MB disk for the default `base.en` model (more for larger variants).

## Install + first-run

```bash
cd apps/voice-stt
bun install
bun run download-model            # downloads ggml-base.en.bin into ./models/
bun run start                     # listens on http://127.0.0.1:4150 by default
```

## Configuration (env vars)

| Variable                | Default        | Notes |
|-------------------------|----------------|-------|
| `VOICE_STT_PORT`        | `4150`         | TCP port. |
| `VOICE_STT_HOST`        | `127.0.0.1`    | Bind address. Use the tailnet IP to expose to other devices. |
| `VOICE_STT_MODEL`       | `base.en`      | Whisper model id. Available: `tiny.en`, `base.en`, `small.en`. |
| `VOICE_STT_MODEL_PATH`  | (unset)        | If set, points at a vendored `.bin` file and disables auto-download. |

## API

### `GET /health`

```json
{ "ok": true, "model": "base.en", "modelPath": null }
```

### `POST /transcribe`

Accepts EITHER:

1. `multipart/form-data` with field `audio` containing the audio file.
2. Raw audio body with `Content-Type: audio/webm` (or `audio/wav`,
   `audio/mp3`, `audio/mp4`, `audio/ogg`).

Returns:

```json
{ "text": "your transcribed prompt" }
```

On error returns HTTP 4xx/5xx with `{ "error": "..." }`.

## Vendoring the model in the repo

The `.gitattributes` at the repo root tracks `*.bin` / `*.gguf` via Git
LFS. After `bun run download-model`:

```bash
git add apps/voice-stt/models/ggml-base.en.bin
git commit -m "voice-stt: vendor base.en whisper model"
```

The model lives in LFS, not the regular git pack, so clones stay fast for
contributors who don't enable voice mode.

## Tests

```bash
bun test                         # unit tests for the HTTP handler
bun test:integration             # spawns an isolated opencode + verifies
                                 # frontend → sidecar → opencode prompt flow
```

The integration test fixture lives at `tests/fixtures/example-project/`
and is the codebase the spawned opencode operates on. The sandbox uses
`OPENCODE_DATA_DIR=tests/fixtures/.sandbox/` so it never touches the
user's real `~/.local/share/opencode/opencode.db`.

## Running on the tailnet

```bash
VOICE_STT_HOST=$(tailscale ip -4 | head -n1) \
VOICE_STT_PORT=4150 \
VOICE_STT_MODEL=base.en \
VOICE_STT_MODEL_PATH=$(pwd)/models/ggml-base.en.bin \
bun run start
```

Then in openportal Settings → Prompt → Voice input → set "Backend" to
"Whisper sidecar" and the URL to `http://<tailnet-ip>:4150`.

## Roadmap

- Streaming partial transcripts via WebSocket
- Multi-language support (drop the `.en` constraint)
- VAD inside the browser (currently the sidecar transcribes one chunk per
  `/transcribe` call; VAD-driven sessions submit multiple chunks)
- GPU acceleration via `whisper.cpp` CUDA build
