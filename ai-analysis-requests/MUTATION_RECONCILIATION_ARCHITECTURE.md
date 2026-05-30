# Mutation reconciliation architecture (openportal-as-write-cache)

## The problem

OpenCode's HTTP API is slow on writes - PATCH /session/<id> can take 100-500ms,
sometimes more if the disk is busy. The previous UX pattern was:

1. Frontend fires PATCH (e.g. archive, unarchive, rename)
2. UI freezes until the request returns
3. After return, SWR re-fetches /sessions
4. UI updates

Net latency from user click to visible change: ~400-1000ms. On a fast site this
reads as broken.

The recently-shipped client-side optimistic SWR mutate (commit `1c044ea`)
hides this for archive/unarchive specifically, but the pattern is ad-hoc:
each new mutation has to re-implement the optimistic patch in the hook,
duplicate the resolution rule in every consumer, and trust that the client's
cached sessions list isn't being read from a different place that doesn't
know about the patch.

## The principle

> OpenPortal is the source of truth for everything the user has ever observed.
> (from AGENTS.md "Caching proxy + authoritative-only invariants")

The existing caching proxy handles reads. Writes need the same pattern -
OpenPortal records the user's intent the instant the request lands, and
every subsequent /sessions response carries that intent as a first-class
overlay field. The frontend reads the overlay before falling back to
opencode's authoritative field. Once opencode catches up, the overlay
is reconciled away.

## Two-field shape

Every mutable field on a session that needs immediate UI reaction gets
a sibling overlay field. The overlay field is what the UI reads; the
authoritative field is what opencode returns.

```
Session {
  id: "ses_xxx"
  title: "Original title"          // opencode's authoritative value
  time: { archived: 0 }            // opencode's authoritative value
  _pendingTitle?: {                // overlay - portal's pending mutation
    value: "New title"
    setAt: 1748000000000
  }
  _pendingArchived?: {             // overlay - portal's pending mutation
    value: 1748000000000           // 0 means "unarchive"
    setAt: 1748000000000
  }
}
```

The frontend never reads `time.archived` or `title` directly. It always
goes through `effectiveArchivedAt(s)` / `effectiveTitle(s)` which return
the overlay value if present, else the authoritative value.

## Server-side flow

### `apps/web/src/server/lib/session-overlay.ts`

In-memory `Map<port, Map<sessionId, OverlayState>>`. API:

- `setOverlayField(port, sid, field, value)` - record pending mutation
- `clearOverlayField(port, sid, field)` - clear after success or rollback
- `applyOverlay(port, session)` - merge overlay onto session record
- `reconcile(port, sessions[])` - for each pending field, if opencode's
  value matches the pending value, clear that overlay entry

Per-port keying because each opencode has its own session ID space.

Persistence: in-memory only for v0. Process restart wipes the overlay;
sessions-cache hydrates from opencode and the user's pending mutations
are either already reflected in opencode (clean) or genuinely lost (rare
race). For v1 we can persist to `~/.openportal-state.json` if needed.

### `apps/web/src/server/opencode/[port]/sessions.ts`

After fetching from opencode (or reading from cache), pass through
`applyOverlay` so each session in the response carries any pending
overlay fields, then call `reconcile` to clear fields that opencode
has caught up on.

### Mutation endpoints

Pattern (archive example):

```ts
export default defineHandler(async (event) => {
  const port = parsePort(event);
  const sid = parseRouteParam(event, "id");
  const now = Date.now();

  // 1. Record intent IMMEDIATELY - any concurrent /sessions poll
  //    sees the pending value before opencode does
  setOverlayField(port, sid, "_pendingArchived", { value: now, setAt: now });
  invalidateSessionsCache(port); // force next read to re-fetch from opencode

  try {
    const res = await fetchOpencode(port, `/session/${sid}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ time: { archived: now } }),
    });
    if (!res.ok) {
      clearOverlayField(port, sid, "_pendingArchived");
      throw new Error(`archive failed: ${res.status} ${await res.text()}`);
    }
    return res.json();
    // Overlay stays in place. Next /sessions GET re-fetches from opencode;
    // if opencode now reports archived=now, reconcile() clears the overlay
    // automatically. If opencode is still lagging, the overlay stays until
    // it catches up.
  } catch (err) {
    clearOverlayField(port, sid, "_pendingArchived");
    throw err;
  }
});
```

## Client-side flow

### `apps/web/src/lib/session-overlay.ts`

```ts
export function effectiveArchivedAt(s: Session): number {
  const overlay = (s as any)._pendingArchived;
  if (overlay?.value !== undefined) return overlay.value;
  return (s.time?.archived as number) ?? 0;
}

export function effectiveTitle(s: Session): string | undefined {
  const overlay = (s as any)._pendingTitle;
  if (overlay?.value !== undefined) return overlay.value;
  return s.title;
}

export function isPendingArchive(s: Session): boolean {
  return (s as any)._pendingArchived !== undefined;
}
```

### Sidebar / nav / anywhere session fields are read

Replace direct reads:
- `(s.time as ...).archived` → `effectiveArchivedAt(s)`
- `s.title` → `effectiveTitle(s) ?? s.id`

The previous client-side optimistic mutate inside `useArchiveSession` /
`useUnarchiveSession` can be dropped - the server overlay does the same
job centrally for every consumer (sidebar, info modal, multi-tab, fresh
page load, mobile, etc.).

### Mutation hooks

Simplify: just call the endpoint and trigger SWR mutate after success.

```ts
export function useArchiveSession() {
  const port = usePort();
  const { mutate } = useSWRConfig();
  return async (sessionId: string) => {
    if (!port) throw new Error("No instance selected");
    const res = await fetch(
      `/api/opencode/${port}/session/${sessionId}/archive`,
      { method: "POST" },
    );
    if (!res.ok) throw new Error(`Failed to archive session: ${res.status}`);
    void mutate(`/api/opencode/${port}/sessions`); // re-fetch with overlay
    return res.json();
  };
}
```

The server-side overlay is already set by the time the response returns,
so the SWR re-fetch immediately gets the pending state.

## Reconciliation

`reconcile(port, sessions[])` runs on every /sessions response. For each
session and each overlay field:

- If opencode's authoritative value now matches the pending value, clear
  the overlay entry (the mutation has landed).
- If the overlay is older than `RECONCILE_MAX_AGE_MS` (30s default) AND
  opencode still disagrees, clear it anyway and log. This guards against
  a mutation that silently failed at the opencode layer despite returning
  200, or against a stale overlay from a crashed handler.

Stale-cleanup is a safety net, not a correctness path. Normal flow:
mutation succeeds → opencode reflects it within 1-2s → next /sessions GET
sees match → overlay cleared.

## Coverage in v1

Three fields wired through the layer:

- `_pendingArchived` (number, 0 = unarchived, >0 = archived timestamp)
  - `POST /session/<id>/archive`
  - `POST /session/<id>/unarchive`
- `_pendingTitle` (string)
  - `PATCH /session/<id>` with `{ title: "..." }`

Future fields that should follow the same pattern (not in v1):

- `_pendingDeleted` - DELETE /session/<id> (so the row vanishes
  immediately instead of waiting for opencode to confirm)
- `_pendingMovedTo` - POST /session/<id>/move-to-project
- `_pendingPinned` - if we ever add pin/unpin on the session itself

## UX side-effect: burger unarchive no-confirm

Tightly coupled to the architecture rollout: per the user's directive,
the hamburger menu's Unarchive action should fire immediately (no
confirmation), matching the existing burger Archive behaviour. The
no-confirm risk on Unarchive is lower than Archive (the row remains
visible until the user clicks away) AND the overlay layer makes the
action instantly reversible without a round-trip wait.

## Why not just keep the client-side optimistic mutate?

It works for the two hooks currently using it. But:

1. **Every new mutation re-implements the pattern.** Rename, move,
   delete each need their own `mutate(key, updater, { revalidate: false })`
   call. The shape of the optimistic update has to match the consumer's
   read shape. Drift is easy.
2. **Consumers in different places read sessions from different SWR
   keys.** Sidebar reads `/sessions`; info modal might read
   `/session/<id>`; future analytics might aggregate from a third key.
   Client-side patching requires patching every cache key the mutation
   could affect. Server overlay handles all of them for free because
   every read passes through it.
3. **Multi-tab divergence.** Tab A archives; tab B is also open. With
   client-side optimistic, tab B's SWR cache doesn't know. Tab B sees
   the change only on its next SWR poll, which can be seconds later.
   With server overlay, tab B's next poll sees the overlay immediately
   because it's the server applying it.
4. **Fresh page load during pending state.** With client-side
   optimistic, opening the app in a new tab during an in-flight
   mutation shows opencode's stale state. With server overlay, the
   first /sessions GET in the new tab includes the overlay.

The server overlay is the architecturally correct layer, and as a bonus
it's the cheaper place to extend for new mutations.

## Files touched

Server:
- `apps/web/src/server/lib/session-overlay.ts` (new)
- `apps/web/src/server/opencode/[port]/sessions.ts` (apply overlay)
- `apps/web/src/server/opencode/[port]/session/[id]/archive.post.ts`
- `apps/web/src/server/opencode/[port]/session/[id]/unarchive.post.ts`
- `apps/web/src/server/opencode/[port]/session/[id]/index.patch.ts`

Client:
- `apps/web/src/lib/session-overlay.ts` (new)
- `apps/web/src/components/app-sidebar.tsx` (use effective helpers)
- `apps/web/src/components/app-sidebar-nav.tsx` (burger unarchive no-confirm; effective title; rename simplification)
- `apps/web/src/hooks/use-opencode.ts` (drop client-side optimistic patch; just mutate on success)
