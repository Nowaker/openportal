---
status: DONE
commit: e99fc88
session: ses_19acecfc9ffeLwGYd7kS56G7wf
queued_at: 2026-05-26T14:45:46-05:00
legacy_number: 65
---

# Compaction events render as chat log entries

User prompt (verbatim):

> enqueue after current: ses_229d7083fffem6lkaEj69adZ7H when viewed in opencode web ui, i see a lot of compaction events. openportal does not show them at all. every compaction event trigger should be seen as a chat log entry.

Design notes (e99fc88, DONE):
- Verified on `ses_229d7083fffem6lkaEj69adZ7H`: 156 compaction parts in the message stream. Each is a user-role message with a SINGLE `type:"compaction"` part (shape `{id, sessionID, messageID, type:"compaction", auto: bool, overflow?: bool, tail_start_id?: string}`). `hasVisibleContent` returned false for those messages (no text/tool/file part), so they were filtered out before reaching `MessageItem`.
- `isCompactionPart` predicate added alongside `isToolPart` / `isFilePart`. `CompactionPartShape` captures the extra fields opencode emits but `@opencode-ai/sdk@1.14.50`'s `CompactionPart` is missing (overflow + tail_start_id).
- `hasVisibleContent` now includes `hasCompactions`; `compactionParts` derived in `MessageItem` alongside toolCalls/fileParts.
- `CompactionEventRow` component renders a horizontal dashed divider with a centered chip: `ArchiveBoxIcon` + "Auto-compaction" / "Manual compaction" label + optional "overflow" pill when `overflow=true`. Tooltip explains the full state (auto/manual, overflow, tail_start_id).
- Render site: after permission decisions, before the errorDescription `ErrorBox` — so the marker sits at the chronological end of the message but above any failure banner.
- Chat log now matches opencode web UI parity for compaction visibility.
