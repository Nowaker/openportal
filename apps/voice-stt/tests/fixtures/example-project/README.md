# Example project for voice-stt + opencode end-to-end tests

A minimal TypeScript project used as the workspace root when running
voice-stt against a sandboxed opencode instance in CI.

The CI workflow at `.github/workflows/voice-stt.yml` (workflow_dispatch
job `e2e-with-opencode`) does roughly:

```bash
opencode serve --port 4496 \
  --hostname 127.0.0.1 \
  --directory tests/fixtures/example-project &
OPENCODE_PID=$!

bun --cwd apps/voice-stt run start &
VOICE_PID=$!

# wait for both to be ready
curl --retry 30 --retry-delay 1 http://127.0.0.1:4496/config/providers
curl --retry 30 --retry-delay 1 http://127.0.0.1:4150/health

# run end-to-end test
bun test tests/e2e.test.ts

kill $OPENCODE_PID $VOICE_PID
```

The example project intentionally contains a few real source files so
that opencode's tool calls (read, edit, list, grep) can exercise actual
filesystem behaviour rather than empty-directory edge cases.

## Layout
- `package.json` - bun workspace stub
- `index.ts` - simple greet function
- `index.test.ts` - bun-test for the greet function
- `README.md` - this file (also serves as a "test target" for tools that
                read repo READMEs)
