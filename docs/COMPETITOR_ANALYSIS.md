# Competitor analysis - OpenCode-adjacent web UIs

Researched 2026-05-21 as a continuation of Task 7 ("openchamber + codenomad
analysis"). Identifies feature gaps openportal could close and confirms
openportal's positioning relative to four adjacent projects.

## OpenChamber - openchamber.dev (Boris @Boripheus)

**Architecture**: Native macOS desktop app + browser/PWA + VS Code extension,
all on top of the OpenCode SDK.

**Distinctive features**:
- Multi-window project workflows on the native macOS app (a project per
  window, with the OS managing the chrome).
- "Open In" shortcuts for Finder / Terminal / editor straight from any
  session.
- "Project Actions" for dev servers, SSH forwarding, local URLs.
- UI password gate that makes browser access public-ready (think: openportal
  served behind no auth on the tailnet, OpenChamber's gate would be the
  layer ABOVE that).
- VS Code extension: right-click context actions on selections / files,
  open files directly from tool output, Agent Manager for parallel
  multi-model runs.
- Tunnel-based remote access (Cloudflare Tunnel-style) with rotatable links.

**What openportal could borrow**:
- The VS Code right-click context-action layer. openportal already
  uses `vscode://` deeplinks; OpenChamber's extension flips the
  direction (VS Code -> openportal) which would let the user start a
  prompt from a code selection in VS Code.
- "Project Actions" - a registered catalog of `npm run dev`-style
  shortcuts per project, visible in the session chrome.
- UI password gate as a one-line opt-in for users who briefly need
  openportal reachable outside the tailnet.

**What openportal already does better**:
- Configless registry + multi-server fan-out across hosts.
- Tailnet-native (no UI password needed inside the tailnet ACL).
- Indicator broadcaster + cross-session attention dots.
- Prompt archive + per-instance settings persistence.

## CodeNomad - github.com/NeuralNomadsAI/CodeNomad

**Architecture**: Electron desktop app + standalone server mode for browser
access. SolidJS frontend. Wraps + proxies OpenCode.

**Distinctive features**:
- Multi-instance workspace with tabs - several OpenCode sessions
  side-by-side in one UI.
- Global command palette (Cmd-K style) for jump-to-tab, launch-tool,
  control-anything.
- Long-session-native: claims hitch-free scrolling on massive transcripts.
- Deep task awareness: monitor background tasks + child sessions.
- Server mode: `codenomad serve` + web browser, no Electron needed.

**What openportal could borrow**:
- The COMMAND PALETTE. openportal has a slash-command popover bound to
  the composer; a global Cmd-K palette that searches across
  sessions / projects / settings tabs / actions would be a 10x
  navigation win.
- Tabs in the active workspace. openportal already shows pinned
  sessions horizontally - a small step from there to draggable
  per-window tabs.
- Long-session optimisation. openportal's smart-window loader
  (use-session-messages) and SDK-with-raw-fallback already address
  most of this, but the "load all" path is still rough.

**What openportal already does better**:
- SSE-driven indicator broadcaster gives openportal real-time queued /
  question / permission state without per-session polling.
- Server-side prompt archive search via FTS5.
- Cross-tab BroadcastChannel composer sync.

## Nomadex - github.com/xaenic/nomadex

**Architecture**: Browser workspace + local app-server bridge. Provider-
agnostic shell (Codex / OpenCode / Qwen Code live; Claude Code +
Antigravity planned).

**Distinctive features**:
- Multi-provider provider layer: same UI drives Codex, OpenCode, Qwen
  Code, eventually Claude Code.
- Mobile-friendly responsive shell, tail-first transcript loading.
- File attachments + image paste + diff review.
- Approvals + steer + question prompts surfaced on mobile.
- Tailscale-friendly remote access ("safer than exposing the desktop").

**What openportal could borrow**:
- The provider abstraction. Today openportal speaks OpenCode-only;
  adding a thin shim to drive Claude Code in addition would 2-3x
  the addressable audience without rewriting the chat surface.
- "Steer" - mid-turn directive injection (interrupt the model with
  a course correction without aborting + resubmitting). openportal
  has no equivalent today.
- Diff review surface on mobile.

**What openportal already does better**:
- Already tailnet-native, ahead of Nomadex's "tunnel optional"
  framing.
- Multi-server registry > Nomadex's per-provider tabs.
- Indicator broadcaster + prompt archive aren't in Nomadex.

## OpenCode-Manager - github.com/chriswritescode-dev/opencode-manager

**Architecture**: Mobile-first PWA, Docker-deployable. Multi-repo + git
integration.

**Distinctive features**:
- Git multi-repo + SSH-auth + worktrees + unified diffs + PR creation
  baked into the UI.
- Schedules: recurring repo jobs with reusable prompts + run history +
  linked sessions + markdown-rendered output.
- Plan/Build mode toggle (mirrors OpenCode's plan-vs-build agents).
- Audio: TTS + STT, both browser-native AND OpenAI-compatible
  endpoints.
- OAuth for Anthropic + GitHub Copilot.
- MCP server templates.
- Persistent project knowledge with semantic search.

**What openportal could borrow**:
- SCHEDULES. This is genuinely novel - "run this prompt against this
  repo every weekday at 3pm" with run history. openportal could
  layer this on top of the existing prompt archive + a small cron
  worker.
- Plan/Build mode toggle as a visible composer state (openportal has
  AgentSelect but doesn't surface plan-vs-build prominently).
- TTS for assistant responses. openportal has STT (use-stt-engine);
  the reverse - voice-out for the model's reply - is one half-day
  away.
- Mermaid diagram rendering in chat. openportal's markdown-renderer
  could grow a remark-mermaid plugin.
- ZIP download of a directory subtree from the file browser.

**What openportal already does better**:
- Configless multi-host server registry.
- Auto-approve permissions with per-session overrides.
- Prompt archive search across sessions.
- Cross-tab presence tracking + browser-vs-curl-aware sudo dispatch.
- Indicator broadcaster.

## Summary - prioritised port targets

If openportal were to absorb features from these four, ranked by
"value delta per implementation hour":

1. **Global command palette (Cmd-K)** [CodeNomad] - 1-2 days,
   massive navigation win. Hook into existing session list, prompts
   archive, settings tabs, file browser.

2. **Schedules / recurring prompt jobs** [OpenCode-Manager] - 2-3 days,
   genuinely novel. Existing prompt archive + a cron worker + a
   schedules tab. Pairs well with the indicator broadcaster.

3. **TTS for assistant responses** [OpenCode-Manager] - half-day,
   completes the audio loop. Existing STT + Web Speech / OpenAI TTS.

4. **Mermaid in markdown** [OpenCode-Manager] - half-day,
   remark-mermaid + a sandboxed renderer.

5. **"Steer" mid-turn directive** [Nomadex] - 1-2 days, needs
   opencode-side investigation (does the prompt_async pipeline
   support injecting a continuation while the assistant is still
   generating?).

6. **Project Actions catalog** [OpenChamber] - 1 day per surface,
   a per-project list of shell commands (dev server, test runner,
   build) launched from the openportal chrome.

7. **Multi-provider shim (Claude Code, Codex)** [Nomadex] - 3-5 days,
   significant audience expansion but architecturally invasive
   (the entire `/api/opencode/...` namespace + the indicator
   broadcaster assume opencode-shaped events).

Items NOT worth porting:
- Electron desktop app (CodeNomad) - openportal is web-native by
  design.
- macOS-only multi-window (OpenChamber) - same reason.
- UI password gate (OpenChamber) - tailnet ACL already covers this.

## What openportal has that NONE of them have

For positioning + roadmap clarity:

- **Configless multi-server registry**. None of the four discover +
  proxy multiple OpenCode hosts the way openportal does
  (`servers.tsx` + the inspect-host scanner).
- **Cross-tab BroadcastChannel composer sync** + draft persistence
  with the prefix-strip-on-submit smart-clear (c084f12 / 40ab1c4
  family).
- **Prompt archive with FTS search across sessions** + the
  prompts-only filter mode in $id.tsx.
- **Indicator broadcaster + cross-session attention dots** via SSE.
- **Browser-vs-curl presence detection** for the sudo dispatch
  (presence-tracker.ts).
- **Stuck-detector + auto-recovery via session forking** (the
  upstream opencode-stuck-detector / opencode-stuck-compaction-fixer
  pair that openportal coexists with).
- **OpenCode binary update watcher** (4116c7c).
- **Sandboxed file browser with new-folder + new-file write
  endpoints** (2cd105d).
- **System stats + per-process RSS/CPU in diagnostics** (f53f50d).
